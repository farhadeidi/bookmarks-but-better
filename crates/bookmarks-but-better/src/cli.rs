//! The `bookmarks-but-better` command line.
//!
//! Every subcommand takes `--vault` explicitly. There is no discovery, no
//! search of parent directories and no configured default: the one directory
//! the daemon may touch is the one the user named on the command line, and
//! making that impossible to get wrong by accident is worth the extra typing.

use std::io::{self, IsTerminal as _, Write as _};
use std::net::IpAddr;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use crate::doctor;
use crate::init::{self, InitOutcome};
use crate::registry::VaultSpec;
use crate::server::{self, DEFAULT_BIND, DEFAULT_PORT, Daemon, ServeOptions};
use crate::service;
use crate::setup;
use crate::vault::Vault;
use crate::watch::WatchOptions;

/// Local-first bookmarks in a Markdown vault.
#[derive(Debug, Parser)]
#[command(name = "bookmarks-but-better", version, about, long_about = None)]
pub struct Cli {
    /// What to do.
    #[command(subcommand)]
    pub command: Command,

    /// Emit logs as JSON objects rather than as human-readable lines.
    ///
    /// Logs never contain bookmark titles, URLs or file contents in either
    /// format; they carry counts, identities, codes and paths only.
    #[arg(long, global = true)]
    pub log_json: bool,

    /// The log filter, in `tracing` syntax.
    #[arg(
        long,
        global = true,
        default_value = "info",
        env = "BOOKMARKS_BUT_BETTER_LOG"
    )]
    pub log: String,
}

/// The subcommands.
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Serve the vaults and, optionally, the web UI.
    Serve {
        /// A vault to serve, as `PATH` for one vault or `ID=PATH` to name it.
        ///
        /// Repeat the flag to host several vaults in one daemon: each becomes
        /// an independently identified Bookmark Source with vault-scoped
        /// routes under `/api/v1/vaults/{id}/…`. Ids are unique and their
        /// directories must not overlap; a plain `PATH` claims the id
        /// `default`, so two of them collide.
        #[arg(long = "vault", value_name = "PATH | ID=PATH", required = true)]
        vaults: Vec<String>,

        /// The loopback address to bind.
        #[arg(long, default_value_t = DEFAULT_BIND, value_name = "ADDR")]
        bind: IpAddr,

        /// The port to bind; 0 asks the operating system for a free one.
        #[arg(long, default_value_t = DEFAULT_PORT)]
        port: u16,

        /// A directory holding the built web UI to serve.
        #[arg(long, value_name = "PATH")]
        ui_dir: Option<PathBuf>,

        /// Initialize each vault first if it has no root metadata file.
        ///
        /// Without this, serving an uninitialized directory is an error: a
        /// daemon that wrote into whatever path it was handed would turn a
        /// typo into a file in the wrong place.
        #[arg(long)]
        init: bool,
    },

    /// Make a directory into a vault by writing its root metadata file.
    Init {
        /// The directory to initialize. It is created when only this final path
        /// component is missing; parent directories must already exist.
        #[arg(long, value_name = "PATH")]
        vault: PathBuf,
    },

    /// Report on a vault without writing anything.
    Doctor {
        /// The vault directory.
        #[arg(long, value_name = "PATH")]
        vault: PathBuf,
    },

    /// Rescan a vault and report what it holds.
    ///
    /// This is the offline form, for a vault no daemon is serving. A running
    /// daemon is refreshed with `POST /api/v1/rescan` instead.
    Rescan {
        /// The vault directory.
        #[arg(long, value_name = "PATH")]
        vault: PathBuf,
    },

    /// Set up a vault and a background service, answering a few questions.
    Setup,

    /// Manage the background service that serves a vault at login.
    Service {
        /// What to do with the service.
        #[command(subcommand)]
        command: ServiceCommand,
    },
}

/// `bookmarks-but-better service` subcommands.
#[derive(Debug, Subcommand)]
pub enum ServiceCommand {
    /// Install (or upgrade) the user-level service definition.
    ///
    /// User-level throughout: a systemd *user* unit, a macOS `LaunchAgent` or a
    /// Scheduled Task at logon. None of them needs an administrator, because
    /// none of them needs to touch anything but one person's own files.
    Install {
        /// The vault directory. Mandatory, and embedded verbatim in the
        /// service definition.
        #[arg(long, value_name = "PATH")]
        vault: PathBuf,

        /// The port to serve on.
        ///
        /// Left out on an upgrade, the port already installed is kept — so an
        /// installation configured on an earlier default is not moved by an
        /// upgrade that never mentioned a port.
        #[arg(long)]
        port: Option<u16>,

        /// A directory holding the built web UI to serve.
        #[arg(long, value_name = "PATH")]
        ui_dir: Option<PathBuf>,

        /// Install the definition without starting the service.
        #[arg(long)]
        no_start: bool,
    },

    /// Start the installed service.
    Start,

    /// Stop the running service.
    Stop,

    /// Report whether the service is installed and running.
    Status,

    /// Remove the service definition.
    ///
    /// The vault is never touched: this removes one generated file.
    Uninstall,
}

impl Cli {
    /// Runs the parsed command.
    ///
    /// Returns a failure exit code rather than an error so that every command
    /// can decide for itself what "unhealthy" means; `doctor` in particular
    /// exits non-zero on a vault that is readable but holds read-only entries.
    #[must_use]
    pub fn run(self) -> ExitCode {
        self.install_logging();
        match self.command {
            Command::Serve {
                vaults,
                bind,
                port,
                ui_dir,
                init,
            } => run_serve(&vaults, bind, port, ui_dir, init),
            Command::Init { vault } => run_init(&vault),
            Command::Doctor { vault } => run_doctor(&vault),
            Command::Rescan { vault } => run_rescan(&vault),
            Command::Setup => run_setup(),
            Command::Service { command } => run_service(command),
        }
    }

    fn install_logging(&self) {
        use tracing_subscriber::EnvFilter;

        let filter = EnvFilter::try_new(&self.log).unwrap_or_else(|_| EnvFilter::new("info"));
        let builder = tracing_subscriber::fmt().with_env_filter(filter);
        if self.log_json {
            builder.json().init();
        } else {
            builder.with_ansi(io::stderr().is_terminal()).init();
        }
    }
}

fn run_serve(
    vault_arguments: &[String],
    bind: IpAddr,
    port: u16,
    ui_dir: Option<PathBuf>,
    allow_init: bool,
) -> ExitCode {
    if !bind.is_loopback() {
        return fail(format_args!(
            "--bind {bind} is not a loopback address; this milestone serves loopback clients only"
        ));
    }

    let mut specs = Vec::with_capacity(vault_arguments.len());
    for argument in vault_arguments {
        let spec = match VaultSpec::parse(argument) {
            Ok(spec) => spec,
            Err(bad) => {
                return fail(format_args!(
                    "--vault {bad} carries no path; use --vault PATH or --vault ID=PATH"
                ));
            }
        };
        let path = match server::resolve_vault_path(&spec.path) {
            Ok(path) => path,
            Err(error) => {
                return fail(format_args!(
                    "the vault path could not be resolved: {error}"
                ));
            }
        };
        specs.push(VaultSpec::new(spec.id, path));
    }

    if allow_init {
        for spec in &specs {
            match init::initialize(&spec.path) {
                Ok(InitOutcome::Created { id }) => {
                    tracing::info!(vault = %spec.path.display(), %id, "initialized the vault root");
                }
                Ok(InitOutcome::AlreadyInitialized { .. }) => {}
                Err(error) => return fail(format_args!("{error}")),
            }
        }
    }

    let mut options = ServeOptions {
        vaults: specs,
        ..ServeOptions::default()
    }
    .with_address(bind, port);
    options.ui_dir = ui_dir;
    options.watch = WatchOptions::default();

    let runtime = match tokio::runtime::Runtime::new() {
        Ok(runtime) => runtime,
        Err(error) => return fail(format_args!("the async runtime could not start: {error}")),
    };

    runtime.block_on(async move {
        let daemon = match Daemon::open(&options) {
            Ok(daemon) => daemon,
            Err(error) => return fail(format_args!("{error}")),
        };

        let listener = match server::bind(&options).await {
            Ok(listener) => listener,
            Err(error) => {
                return fail(format_args!(
                    "{}:{} could not be bound: {error}",
                    options.bind, options.port
                ));
            }
        };
        let address = match listener.local_addr() {
            Ok(address) => address,
            Err(error) => return fail(format_args!("the bound address is unknown: {error}")),
        };

        for hosted in daemon.registry().all() {
            let snapshot = hosted.vault.snapshot();
            tracing::info!(
                vault_id = %hosted.id,
                vault = %hosted.vault.root().display(),
                generation = snapshot.generation,
                bookmarks = snapshot.scan.bookmarks().count(),
                warnings = snapshot.scan.diagnostics().len(),
                "hosting vault"
            );
        }
        tracing::info!(
            vaults = daemon.registry().len(),
            url = %format_args!("http://{address}"),
            ui = options.ui_dir.is_some(),
            "serving"
        );
        if options.ui_dir.is_none() {
            tracing::info!("no --ui-dir was given, so only the API is served");
        }

        let watch_options = options.watch;
        match daemon
            .serve(listener, shutdown_signal(), watch_options)
            .await
        {
            Ok(()) => {
                tracing::info!("stopped");
                ExitCode::SUCCESS
            }
            Err(error) => fail(format_args!("the server stopped: {error}")),
        }
    })
}

/// Resolves when the process is asked to stop.
///
/// `SIGTERM` is handled as well as Ctrl-C because a user service manager stops
/// the daemon with the former, and an unhandled `SIGTERM` would kill the
/// process mid-write.
async fn shutdown_signal() {
    let interrupt = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = interrupt => tracing::info!(signal = "interrupt", "shutting down"),
        () = terminate => tracing::info!(signal = "terminate", "shutting down"),
    }
}

fn run_init(vault: &std::path::Path) -> ExitCode {
    match init::initialize(vault) {
        Ok(outcome) => {
            let id = outcome.id();
            if outcome.created() {
                println!("initialized vault {} (id {id})", vault.display());
                println!(
                    "  created {}",
                    bookmarks_but_better_vault_core::FOLDER_FILE_NAME
                );
                println!("  sub-directories keep their own identity only once they have one too");
            } else {
                println!("vault {} is already initialized (id {id})", vault.display());
            }
            ExitCode::SUCCESS
        }
        Err(error) => fail(format_args!("{error}")),
    }
}

fn run_doctor(vault: &std::path::Path) -> ExitCode {
    let report = match doctor::examine(vault) {
        Ok(report) => report,
        Err(error) => return fail(format_args!("the vault could not be read: {error}")),
    };

    println!("vault {}", vault.display());
    if report.initialized {
        println!("  root metadata  present");
    } else {
        println!(
            "  root metadata  MISSING — run `bookmarks-but-better init --vault {}`",
            vault.display()
        );
    }
    println!("  bookmarks      {}", report.bookmarks);
    println!("  folders        {}", report.folders);
    if report.daemon_running {
        println!("  daemon         running (the vault may change while you read this)");
    }
    println!("  errors         {}", report.errors.len());
    println!("  warnings       {}", report.warnings.len());
    if !report.unorderable.is_empty() {
        println!("  unorderable    {} folders", report.unorderable.len());
    }

    for finding in &report.errors {
        println!("\nerror  [{}] {}", finding.code, finding.path);
        println!("       {}", finding.detail);
    }
    for finding in &report.warnings {
        println!("\nwarn   [{}] {}", finding.code, finding.path);
        println!("       {}", finding.detail);
    }
    // Not an error: nothing is at risk and every other operation still works.
    // It is called out anyway because a reorder that is refused looks like a
    // bug from the outside, and this is the one place that explains it.
    for finding in &report.unorderable {
        println!("\norder  [{}] {}", finding.code, finding.path);
        println!("       {}", finding.detail);
    }

    if report.is_healthy() {
        println!("\nthe vault is healthy");
        ExitCode::SUCCESS
    } else {
        println!("\nthe vault has problems that require attention");
        ExitCode::FAILURE
    }
}

fn run_rescan(vault: &std::path::Path) -> ExitCode {
    let vault_path = match server::resolve_vault_path(vault) {
        Ok(path) => path,
        Err(error) => {
            return fail(format_args!(
                "the vault path could not be resolved: {error}"
            ));
        }
    };

    let opened = match Vault::open(&vault_path) {
        Ok(opened) => opened,
        Err(error) => return fail(format_args!("the vault could not be scanned: {error}")),
    };
    let snapshot = match opened.reconcile() {
        Ok((snapshot, _)) => snapshot,
        Err(problem) => return fail(format_args!("{problem}")),
    };

    println!("rescanned {}", vault_path.display());
    println!("  generation  {}", snapshot.generation);
    println!("  bookmarks   {}", snapshot.scan.bookmarks().count());
    println!("  diagnostics {}", snapshot.scan.diagnostics().len());
    ExitCode::SUCCESS
}

/// Builds the spec an install would write, resolving the port.
///
/// The executable path is the running binary's own, resolved once: a service
/// definition outlives the shell that created it, so `bookmarks-but-better` on a `PATH` is not
/// good enough — the file has to name the exact program.
fn service_spec(
    vault: &std::path::Path,
    port: Option<u16>,
    ui_dir: Option<PathBuf>,
    layout: &service::ServiceLayout,
    kind: service::ServiceKind,
) -> Result<service::ServiceSpec, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("this program's own path is unknown: {error}"))?;
    let vault = server::resolve_vault_path(vault)
        .map_err(|error| format!("the vault path could not be resolved: {error}"))?;

    let mut spec = service::ServiceSpec::new(exe, vault).map_err(|error| error.to_string())?;
    spec = spec
        .with_port(service::resolve_port(layout, kind, port))
        .map_err(|error| error.to_string())?;
    if let Some(ui_dir) = ui_dir {
        let ui_dir = server::resolve_vault_path(&ui_dir)
            .map_err(|error| format!("the ui directory could not be resolved: {error}"))?;
        spec = spec
            .with_ui_dir(ui_dir)
            .map_err(|error| error.to_string())?;
    }
    Ok(spec)
}

fn run_service_install(
    layout: &service::ServiceLayout,
    kind: service::ServiceKind,
    vault: &std::path::Path,
    port: Option<u16>,
    ui_dir: Option<PathBuf>,
    no_start: bool,
) -> ExitCode {
    // Read before the install rewrites it: this is the port the user had.
    let existing_port = service::resolve_port(layout, kind, None);
    let was_installed = service::is_installed(layout, kind);

    let spec = match service_spec(vault, port, ui_dir, layout, kind) {
        Ok(spec) => spec,
        Err(message) => return fail(format_args!("{message}")),
    };
    if port.is_none() && was_installed {
        println!("keeping the installed port {existing_port}");
    }

    let outcome = match service::install(layout, kind, &spec) {
        Ok(outcome) => outcome,
        Err(error) => return fail(format_args!("{error}")),
    };
    let verb = if outcome.wrote() {
        "wrote"
    } else {
        "unchanged"
    };
    println!("{verb} {} ({})", outcome.path().display(), kind.describe());
    println!("  vault  {}", spec.vault.display());
    println!("  serving http://{}:{}", spec.bind, spec.port);

    if let Err(error) = service::reload(layout, kind) {
        return fail(format_args!("{error}"));
    }
    if no_start {
        return ExitCode::SUCCESS;
    }

    match service::enable_and_start(layout, kind) {
        Ok(()) => {
            println!("started, and enabled at login");
            ExitCode::SUCCESS
        }
        // Honest about the half that is not wired: the definition really is
        // installed, and starting it really is not automatic.
        Err(error @ service::ServiceError::Unwired { .. }) => {
            println!("the definition is installed but not started: {error}");
            ExitCode::SUCCESS
        }
        Err(error) => fail(format_args!("{error}")),
    }
}

fn run_service_status(layout: &service::ServiceLayout, kind: service::ServiceKind) -> ExitCode {
    let state = match service::state(layout, kind) {
        Ok(state) => state,
        Err(error) => return fail(format_args!("{error}")),
    };

    println!("kind       {}", kind.describe());
    println!("definition {}", layout.definition_path(kind).display());
    println!(
        "state      {}",
        match state {
            service::ServiceState::NotInstalled => "not installed",
            service::ServiceState::Running => "running",
            service::ServiceState::Stopped => "installed, not running",
            service::ServiceState::InstalledUnsupervised =>
                "installed; starts at your next login (nothing supervises it)",
        }
    );

    if let Some(vault) = service::installed_vault(layout, kind) {
        println!("vault      {}", vault.display());
    }
    if let Some(port) = service::installed_command_line(layout, kind)
        .as_deref()
        .and_then(service::port_in)
    {
        println!("port       {port}");
    }
    ExitCode::SUCCESS
}

fn run_service(command: ServiceCommand) -> ExitCode {
    let layout = match service::ServiceLayout::from_env() {
        Ok(layout) => layout,
        Err(error) => return fail(format_args!("{error}")),
    };
    let kind = service::preferred_kind();

    match command {
        ServiceCommand::Install {
            vault,
            port,
            ui_dir,
            no_start,
        } => run_service_install(&layout, kind, &vault, port, ui_dir, no_start),

        ServiceCommand::Status => run_service_status(&layout, kind),

        ServiceCommand::Start => match service::start(&layout, kind) {
            Ok(()) => {
                println!("started");
                ExitCode::SUCCESS
            }
            Err(error) => fail(format_args!("{error}")),
        },

        ServiceCommand::Stop => match service::stop(&layout, kind) {
            Ok(()) => {
                println!("stopped");
                ExitCode::SUCCESS
            }
            Err(error) => fail(format_args!("{error}")),
        },

        ServiceCommand::Uninstall => {
            // Best-effort, and deliberately before the file goes: a service
            // manager cannot be asked to stop a unit whose definition is gone.
            service::disable_and_stop(&layout, kind);
            match service::uninstall(&layout, kind) {
                Ok(true) => {
                    println!("removed {}", layout.definition_path(kind).display());
                    println!("your vault was not touched");
                    ExitCode::SUCCESS
                }
                Ok(false) => {
                    println!("nothing to remove: no service definition is installed");
                    ExitCode::SUCCESS
                }
                Err(error) => fail(format_args!("{error}")),
            }
        }
    }
}

fn run_setup() -> ExitCode {
    let mut prompt = setup::Terminal;
    let plan = match setup::plan(&mut prompt) {
        Ok(plan) => plan,
        Err(error) => return fail(format_args!("{error}")),
    };

    if plan.initialize {
        match init::initialize(&plan.vault) {
            Ok(outcome) => println!(
                "initialized vault {} (id {})",
                plan.vault.display(),
                outcome.id()
            ),
            Err(error) => return fail(format_args!("{error}")),
        }
    }

    println!();
    println!("Next: install the background service with");
    println!(
        "  bookmarks-but-better service install --vault {} --port {}",
        plan.vault.display(),
        plan.port
    );
    println!("Then point the extension at http://127.0.0.1:{}", plan.port);
    ExitCode::SUCCESS
}

fn fail(message: std::fmt::Arguments<'_>) -> ExitCode {
    let mut stderr = io::stderr().lock();
    let _ = writeln!(stderr, "error: {message}");
    ExitCode::FAILURE
}
