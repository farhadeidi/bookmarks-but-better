//! The `bookmarks-but-better` command line.
//!
//! Every subcommand names its vault explicitly: as a path, or — since
//! ADR-0005 — as the id of a vault already in the Vault Registry. There is
//! still no discovery and no search of parent directories, and a command that
//! does not say `--from-config` (or name a configured id) cannot reach a
//! directory the command line did not name. What the registry changes is only
//! *when* the naming happened, and `vault list` is what makes it auditable.

use std::io::{self, IsTerminal as _, Write as _};
use std::net::IpAddr;
use std::path::PathBuf;
use std::process::ExitCode;

use clap::{ArgGroup, Parser, Subcommand};

use crate::config::{self, Config, ConfigError, ConfigLocation, VaultEntry};
use crate::doctor;
use crate::init::{self, InitOutcome};
use crate::registry::{self, VaultSpec};
use crate::server::{self, DEFAULT_BIND, DEFAULT_PORT, Daemon, ServeOptions};
use crate::service;
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
    #[command(group(ArgGroup::new("vault-source").required(true).args(["vaults", "from_config"])))]
    Serve {
        /// A vault to serve, as `PATH` for one vault or `ID=PATH` to name it.
        ///
        /// Repeat the flag to host several vaults in one daemon: each becomes
        /// an independently identified Bookmark Source with vault-scoped
        /// routes under `/api/v1/vaults/{id}/…`. Ids are unique and their
        /// directories must not overlap; a plain `PATH` claims the id
        /// `default`, so two of them collide.
        #[arg(long = "vault", value_name = "PATH | ID=PATH", group = "vault-source")]
        vaults: Vec<String>,

        /// Serve every vault in the configuration instead of naming them here.
        ///
        /// The configuration also supplies the port, the bind address and the
        /// UI directory; passing any of those explicitly overrides what it
        /// says, for this run only.
        #[arg(long, group = "vault-source")]
        from_config: bool,

        /// The loopback address to bind. Default: 127.0.0.1.
        #[arg(long, value_name = "ADDR")]
        bind: Option<IpAddr>,

        /// The port to bind; 0 asks the operating system for a free one.
        /// Default: 52222.
        #[arg(long)]
        port: Option<u16>,

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
    #[command(group(ArgGroup::new("doctor-target").required(true).args(["vault", "id"])))]
    Doctor {
        /// The vault directory.
        #[arg(long, value_name = "PATH", group = "doctor-target")]
        vault: Option<PathBuf>,

        /// A configured vault's id, instead of its path.
        #[arg(value_name = "ID", group = "doctor-target")]
        id: Option<String>,
    },

    /// Rescan a vault and report what it holds.
    ///
    /// This is the offline form, for a vault no daemon is serving. A running
    /// daemon is refreshed with `POST /api/v1/rescan` instead.
    #[command(group(ArgGroup::new("rescan-target").required(true).args(["vault", "id"])))]
    Rescan {
        /// The vault directory.
        #[arg(long, value_name = "PATH", group = "rescan-target")]
        vault: Option<PathBuf>,

        /// A configured vault's id, instead of its path.
        #[arg(value_name = "ID", group = "rescan-target")]
        id: Option<String>,
    },

    /// Manage the Vault Registry: what this machine is configured to serve.
    ///
    /// Nothing here starts, stops or reconfigures a running daemon. The
    /// registry says what the *next* daemon will host, and `vault list` shows
    /// where the two disagree.
    Vault {
        /// What to do with the configured vaults.
        #[command(subcommand)]
        command: VaultCommand,
    },

    /// Manage the background service that serves a vault at login.
    Service {
        /// What to do with the service.
        #[command(subcommand)]
        command: ServiceCommand,
    },
}

/// `bookmarks-but-better vault` subcommands.
#[derive(Debug, Subcommand)]
pub enum VaultCommand {
    /// List the configured vaults, and what is true of each one now.
    List {
        /// Emit the configuration as JSON rather than as a table.
        #[arg(long)]
        json: bool,
    },

    /// Add a vault to the configuration.
    ///
    /// The path is stored absolute, so the entry means the same thing from any
    /// working directory. The set is validated exactly as a daemon would
    /// validate it at startup, so an id or an overlap `serve` would refuse is
    /// refused here — against the command that made the mistake.
    Add {
        /// The vault's id: 1–64 lowercase letters, digits and hyphens.
        #[arg(value_name = "ID")]
        id: String,

        /// The vault's root directory.
        #[arg(value_name = "PATH")]
        path: PathBuf,

        /// Initialize the directory first when it is not already a vault.
        #[arg(long)]
        init: bool,
    },

    /// Remove a vault from the configuration.
    ///
    /// The directory and everything in it are left exactly as they are: this
    /// removes one line from one file.
    Remove {
        /// The vault's id.
        #[arg(value_name = "ID")]
        id: String,
    },

    /// Give a configured vault a different id.
    ///
    /// The id is what clients address the vault by, so a rename is a change
    /// clients see: an extension pointed at the old id finds it gone.
    Rename {
        /// The id it has now.
        #[arg(value_name = "ID")]
        id: String,

        /// The id it should have.
        #[arg(value_name = "NEW-ID")]
        new_id: String,
    },

    /// Print one configured vault's root directory, and nothing else.
    ///
    /// For scripting: no label, no decoration, one line, and a non-zero exit
    /// when the id is not configured.
    Path {
        /// The vault's id.
        #[arg(value_name = "ID")]
        id: String,
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
    #[command(group(ArgGroup::new("service-vaults").required(true).args(["vaults", "from_config"])))]
    Install {
        /// A vault to serve, as `PATH` for one vault or `ID=PATH` to name it.
        ///
        /// Repeat the flag to install a service that hosts several. Every path
        /// is embedded verbatim in the service definition.
        #[arg(
            long = "vault",
            value_name = "PATH | ID=PATH",
            group = "service-vaults"
        )]
        vaults: Vec<String>,

        /// Install a service for every vault in the configuration.
        ///
        /// The configuration is read once, here: what it says is expanded into
        /// the definition, so editing it later does not silently change what an
        /// installed service starts. Re-run this to apply such a change.
        #[arg(long, group = "service-vaults")]
        from_config: bool,

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
    Status {
        /// Emit the report as JSON rather than as lines.
        #[arg(long)]
        json: bool,
    },

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
                from_config,
                bind,
                port,
                ui_dir,
                init,
            } => run_serve(&vaults, from_config, bind, port, ui_dir, init),
            Command::Init { vault } => run_init(&vault),
            Command::Doctor { vault, id } => match resolve_vault_argument(vault, id) {
                Ok(vault) => run_doctor(&vault),
                Err(message) => fail(format_args!("{message}")),
            },
            Command::Rescan { vault, id } => match resolve_vault_argument(vault, id) {
                Ok(vault) => run_rescan(&vault),
                Err(message) => fail(format_args!("{message}")),
            },
            Command::Vault { command } => run_vault(command),
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

/// The vaults `serve` was asked to host, from the configuration or the command
/// line — never both, which the argument group already guarantees.
///
/// Split out of [`run_serve`] because resolving *what* to host is a separable
/// question from binding a socket and opening it, and because the paths that
/// can fail here all fail the same way: a message and no daemon.
fn resolve_serve_vaults(
    vault_arguments: &[String],
    configured: &Config,
    from_config: bool,
) -> Result<Vec<VaultSpec>, String> {
    if from_config {
        if configured.vaults.is_empty() {
            return Err(
                "the configuration lists no vault to serve; add one with `bookmarks-but-better vault add <ID> <PATH>`"
                    .to_owned(),
            );
        }
        return Ok(configured.specs());
    }

    let mut specs = Vec::with_capacity(vault_arguments.len());
    for argument in vault_arguments {
        let spec = VaultSpec::parse(argument).map_err(|bad| {
            format!("--vault {bad} carries no path; use --vault PATH or --vault ID=PATH")
        })?;
        let path = server::resolve_vault_path(&spec.path)
            .map_err(|error| format!("the vault path could not be resolved: {error}"))?;
        specs.push(VaultSpec::new(spec.id, path));
    }
    Ok(specs)
}

fn run_serve(
    vault_arguments: &[String],
    from_config: bool,
    bind: Option<IpAddr>,
    port: Option<u16>,
    ui_dir: Option<PathBuf>,
    allow_init: bool,
) -> ExitCode {
    // Read first, so a configuration that cannot be parsed is reported before
    // anything is bound, opened or locked.
    let configured = if from_config {
        match load_config() {
            Ok(config) => config,
            Err(message) => return fail(format_args!("{message}")),
        }
    } else {
        Config::default()
    };

    // An explicit flag beats the configuration, which beats the default. That
    // ordering is what lets `--from-config --port 0` be a one-off without
    // editing the file.
    let bind = bind.or(configured.bind).unwrap_or(DEFAULT_BIND);
    let port = port.or(configured.port).unwrap_or(DEFAULT_PORT);
    let ui_dir = ui_dir.or_else(|| configured.ui_dir.clone());

    if !bind.is_loopback() {
        return fail(format_args!(
            "--bind {bind} is not a loopback address; this milestone serves loopback clients only"
        ));
    }

    let specs = match resolve_serve_vaults(vault_arguments, &configured, from_config) {
        Ok(specs) => specs,
        Err(message) => return fail(format_args!("{message}")),
    };

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

/// The configuration, or why it could not be read.
///
/// Every caller here treats a configuration problem the same way — say what is
/// wrong with which file and stop — so the error carries the message and the
/// lookup of the file lives once.
fn load_config() -> Result<Config, ConfigError> {
    config::load(&ConfigLocation::from_env()?)
}

/// Resolves the vault a command was pointed at: a path, or a configured id.
///
/// The argument parser has already guaranteed exactly one of the two is
/// present, so the "neither" arm is unreachable in practice and is still
/// answered rather than panicked on.
fn resolve_vault_argument(
    vault: Option<PathBuf>,
    id: Option<String>,
) -> Result<PathBuf, ConfigError> {
    if let Some(vault) = vault {
        return Ok(vault);
    }
    let id = id.unwrap_or_default();
    let config = load_config()?;
    config
        .vaults
        .get(&id)
        .map(|entry| entry.path.clone())
        .ok_or_else(|| ConfigError::UnknownVault {
            known: config.vaults.keys().cloned().collect(),
            id,
        })
}

fn run_vault(command: VaultCommand) -> ExitCode {
    let location = match ConfigLocation::from_env() {
        Ok(location) => location,
        Err(error) => return fail(format_args!("{error}")),
    };
    let config = match config::load(&location) {
        Ok(config) => config,
        Err(error) => return fail(format_args!("{error}")),
    };

    match command {
        VaultCommand::List { json } => run_vault_list(&location, &config, json),
        VaultCommand::Add { id, path, init } => run_vault_add(&location, config, &id, &path, init),
        VaultCommand::Remove { id } => run_vault_remove(&location, config, &id),
        VaultCommand::Rename { id, new_id } => run_vault_rename(&location, config, &id, &new_id),
        VaultCommand::Path { id } => run_vault_path(&config, &id),
    }
}

/// What is true of a configured vault's directory right now.
///
/// Deliberately cheap: three `stat`-shaped questions and the advisory lock, not
/// a scan. `vault list` runs this once per vault and must stay instant however
/// large the vaults are; `doctor` is the command that reads their contents.
fn describe_vault_state(path: &std::path::Path) -> &'static str {
    if !path.exists() {
        return "directory missing";
    }
    if !path.is_dir() {
        return "not a directory";
    }
    if !path
        .join(bookmarks_but_better_vault_core::FOLDER_FILE_NAME)
        .exists()
    {
        return "not initialized";
    }
    if doctor::daemon_is_running(path) {
        return "served now";
    }
    "ok"
}

fn run_vault_list(location: &ConfigLocation, config: &Config, json: bool) -> ExitCode {
    if json {
        let vaults: Vec<_> = config
            .vaults
            .iter()
            .map(|(id, entry)| {
                serde_json::json!({
                    "id": id,
                    "path": entry.path,
                    "state": describe_vault_state(&entry.path),
                })
            })
            .collect();
        let document = serde_json::json!({
            "configuration": location.path(),
            "bind": config.bind.unwrap_or(DEFAULT_BIND).to_string(),
            "port": config.port.unwrap_or(DEFAULT_PORT),
            "uiDir": config.ui_dir,
            "vaults": vaults,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&document).unwrap_or_default()
        );
        return ExitCode::SUCCESS;
    }

    println!("configuration {}", location.path().display());
    println!(
        "serving       http://{}:{}",
        config.bind.unwrap_or(DEFAULT_BIND),
        config.port.unwrap_or(DEFAULT_PORT)
    );
    if let Some(ui_dir) = &config.ui_dir {
        println!("web UI        {}", ui_dir.display());
    }

    if config.vaults.is_empty() {
        println!();
        println!("no vault is configured yet");
        println!("  add one: bookmarks-but-better vault add <ID> <PATH>");
        return ExitCode::SUCCESS;
    }

    // Padded to the widest id so the paths line up; ids are capped at 64
    // characters, so this cannot run away.
    let width = config.vaults.keys().map(String::len).max().unwrap_or(2);
    println!();
    for (id, entry) in &config.vaults {
        println!(
            "{id:<width$}  {}  ({})",
            entry.path.display(),
            describe_vault_state(&entry.path)
        );
    }
    ExitCode::SUCCESS
}

fn run_vault_add(
    location: &ConfigLocation,
    mut config: Config,
    id: &str,
    path: &std::path::Path,
    allow_init: bool,
) -> ExitCode {
    let path = match server::resolve_vault_path(path) {
        Ok(path) => path,
        Err(error) => {
            return fail(format_args!(
                "the vault path could not be resolved: {error}"
            ));
        }
    };

    if let Some(existing) = config.vaults.get(id) {
        return fail(format_args!(
            "a vault `{id}` is already configured at {}; remove it first, or choose another id",
            existing.path.display()
        ));
    }

    if allow_init {
        match init::initialize(&path) {
            Ok(InitOutcome::Created { id: vault_id }) => {
                println!("initialized {} (id {vault_id})", path.display());
            }
            Ok(InitOutcome::AlreadyInitialized { .. }) => {}
            Err(error) => return fail(format_args!("{error}")),
        }
    }

    config
        .vaults
        .insert(id.to_owned(), VaultEntry { path: path.clone() });
    if let Err(error) = config::save(location, &config) {
        return fail(format_args!("{error}"));
    }

    println!("added `{id}` -> {}", path.display());
    // Only when a daemon is actually holding one of these vaults. Adding a
    // vault on a machine that is serving nothing has nothing to restart, and
    // saying so anyway would make the first `vault add` anyone runs read like
    // a warning.
    if config
        .vaults
        .values()
        .any(|entry| doctor::daemon_is_running(&entry.path))
    {
        println!("the running daemon does not pick this up until it restarts (ADR-0001)");
    }
    if !allow_init
        && !path
            .join(bookmarks_but_better_vault_core::FOLDER_FILE_NAME)
            .exists()
    {
        println!(
            "note: {} is not an initialized vault yet — run `bookmarks-but-better init --vault {}`",
            path.display(),
            path.display()
        );
    }
    ExitCode::SUCCESS
}

fn run_vault_remove(location: &ConfigLocation, mut config: Config, id: &str) -> ExitCode {
    let Some(entry) = config.vaults.remove(id) else {
        return fail(format_args!(
            "{}",
            ConfigError::UnknownVault {
                id: id.to_owned(),
                known: config.vaults.keys().cloned().collect(),
            }
        ));
    };
    if let Err(error) = config::save(location, &config) {
        return fail(format_args!("{error}"));
    }
    println!("removed `{id}` from the configuration");
    println!("{} was not touched", entry.path.display());
    ExitCode::SUCCESS
}

fn run_vault_rename(
    location: &ConfigLocation,
    mut config: Config,
    id: &str,
    new_id: &str,
) -> ExitCode {
    if config.vaults.contains_key(new_id) {
        return fail(format_args!("a vault `{new_id}` is already configured"));
    }
    let Some(entry) = config.vaults.remove(id) else {
        return fail(format_args!(
            "{}",
            ConfigError::UnknownVault {
                id: id.to_owned(),
                known: config.vaults.keys().cloned().collect(),
            }
        ));
    };
    config.vaults.insert(new_id.to_owned(), entry);
    if let Err(error) = config::save(location, &config) {
        return fail(format_args!("{error}"));
    }
    println!("renamed `{id}` to `{new_id}`");
    println!("clients addressing the old id will not find it; update them too");
    ExitCode::SUCCESS
}

fn run_vault_path(config: &Config, id: &str) -> ExitCode {
    match config.vaults.get(id) {
        // Deliberately bare: this is what a script substitutes.
        Some(entry) => {
            println!("{}", entry.path.display());
            ExitCode::SUCCESS
        }
        None => fail(format_args!(
            "{}",
            ConfigError::UnknownVault {
                id: id.to_owned(),
                known: config.vaults.keys().cloned().collect(),
            }
        )),
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
    vaults: &[VaultSpec],
    port: Option<u16>,
    ui_dir: Option<PathBuf>,
    layout: &service::ServiceLayout,
    kind: service::ServiceKind,
) -> Result<service::ServiceSpec, String> {
    let exe = std::env::current_exe()
        .map_err(|error| format!("this program's own path is unknown: {error}"))?;

    let mut resolved = Vec::with_capacity(vaults.len());
    for vault in vaults {
        let path = server::resolve_vault_path(&vault.path)
            .map_err(|error| format!("the vault path could not be resolved: {error}"))?;
        resolved.push(VaultSpec::new(vault.id.clone(), path));
    }
    // The same validation `serve` does at startup, done now: an unusable id or
    // an overlap installed into a service definition would fail at every login
    // instead of at the command that wrote it.
    registry::validate(&resolved).map_err(|error| error.to_string())?;

    let mut spec =
        service::ServiceSpec::with_vaults(exe, resolved).map_err(|error| error.to_string())?;
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

/// The vaults, port and UI directory a `service install` was asked for.
///
/// A struct rather than a tuple because two of the three are `Option`s of
/// different meaning and would be trivially swappable at the call site.
#[derive(Debug)]
struct ServiceInstallInputs {
    vaults: Vec<VaultSpec>,
    port: Option<u16>,
    ui_dir: Option<PathBuf>,
}

/// Resolves what a `service install` should record.
///
/// `--from-config` expands the Vault Registry here and now (ADR-0005): the
/// definition records paths, never a reference to a file that could later say
/// something else.
fn service_install_inputs(
    vault_arguments: &[String],
    from_config: bool,
    port: Option<u16>,
    ui_dir: Option<PathBuf>,
) -> Result<ServiceInstallInputs, String> {
    if !from_config {
        let mut vaults = Vec::with_capacity(vault_arguments.len());
        for argument in vault_arguments {
            vaults.push(VaultSpec::parse(argument).map_err(|bad| {
                format!("--vault {bad} carries no path; use --vault PATH or --vault ID=PATH")
            })?);
        }
        return Ok(ServiceInstallInputs {
            vaults,
            port,
            ui_dir,
        });
    }

    let configured = load_config().map_err(|error| error.to_string())?;
    if configured.vaults.is_empty() {
        return Err(
            "the configuration lists no vault to serve; add one with `bookmarks-but-better vault add <ID> <PATH>`"
                .to_owned(),
        );
    }
    Ok(ServiceInstallInputs {
        vaults: configured.specs(),
        port: port.or(configured.port),
        ui_dir: ui_dir.or(configured.ui_dir),
    })
}

fn run_service_install(
    layout: &service::ServiceLayout,
    kind: service::ServiceKind,
    vault_arguments: &[String],
    from_config: bool,
    port: Option<u16>,
    ui_dir: Option<PathBuf>,
    no_start: bool,
) -> ExitCode {
    // Read before the install rewrites it: this is the port the user had.
    let existing_port = service::resolve_port(layout, kind, None);
    let was_installed = service::is_installed(layout, kind);

    let inputs = match service_install_inputs(vault_arguments, from_config, port, ui_dir) {
        Ok(inputs) => inputs,
        Err(message) => return fail(format_args!("{message}")),
    };

    let spec = match service_spec(&inputs.vaults, inputs.port, inputs.ui_dir, layout, kind) {
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
    for vault in &spec.vaults {
        println!("  vault  {} ({})", vault.path.display(), vault.id);
    }
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

fn run_service_status(
    layout: &service::ServiceLayout,
    kind: service::ServiceKind,
    json: bool,
) -> ExitCode {
    let state = match service::state(layout, kind) {
        Ok(state) => state,
        Err(error) => return fail(format_args!("{error}")),
    };
    let vaults = service::installed_vaults(layout, kind);
    let port = service::installed_command_line(layout, kind)
        .as_deref()
        .and_then(service::port_in);

    if json {
        let document = serde_json::json!({
            "kind": kind.describe(),
            "definition": layout.definition_path(kind),
            "state": match state {
                service::ServiceState::NotInstalled => "not-installed",
                service::ServiceState::Running => "running",
                service::ServiceState::Stopped => "stopped",
                service::ServiceState::InstalledUnsupervised => "installed-unsupervised",
            },
            "vaults": vaults
                .iter()
                .map(|vault| serde_json::json!({ "id": vault.id, "path": vault.path }))
                .collect::<Vec<_>>(),
            "port": port,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&document).unwrap_or_default()
        );
        return ExitCode::SUCCESS;
    }

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

    for vault in &vaults {
        println!("vault      {} ({})", vault.path.display(), vault.id);
    }
    if let Some(port) = port {
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
            vaults,
            from_config,
            port,
            ui_dir,
            no_start,
        } => run_service_install(&layout, kind, &vaults, from_config, port, ui_dir, no_start),

        ServiceCommand::Status { json } => run_service_status(&layout, kind, json),

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

fn fail(message: std::fmt::Arguments<'_>) -> ExitCode {
    let mut stderr = io::stderr().lock();
    let _ = writeln!(stderr, "error: {message}");
    ExitCode::FAILURE
}
