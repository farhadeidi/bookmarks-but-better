//! The `bbb` command line.
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
use crate::server::{self, DEFAULT_BIND, DEFAULT_PORT, Daemon, ServeOptions};
use crate::vault::Vault;
use crate::watch::WatchOptions;

/// Local-first bookmarks in a Markdown vault.
#[derive(Debug, Parser)]
#[command(name = "bbb", version, about, long_about = None)]
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
    #[arg(long, global = true, default_value = "info", env = "BBB_LOG")]
    pub log: String,
}

/// The subcommands.
#[derive(Debug, Subcommand)]
pub enum Command {
    /// Serve the vault and, optionally, the web UI.
    Serve {
        /// The vault directory. It must already be initialized.
        #[arg(long, value_name = "PATH")]
        vault: PathBuf,

        /// The loopback address to bind.
        #[arg(long, default_value_t = DEFAULT_BIND, value_name = "ADDR")]
        bind: IpAddr,

        /// The port to bind; 0 asks the operating system for a free one.
        #[arg(long, default_value_t = DEFAULT_PORT)]
        port: u16,

        /// A directory holding the built web UI to serve.
        #[arg(long, value_name = "PATH")]
        ui_dir: Option<PathBuf>,

        /// Initialize the vault first if it has no root metadata file.
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
                vault,
                bind,
                port,
                ui_dir,
                init,
            } => run_serve(&vault, bind, port, ui_dir, init),
            Command::Init { vault } => run_init(&vault),
            Command::Doctor { vault } => run_doctor(&vault),
            Command::Rescan { vault } => run_rescan(&vault),
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
    vault: &std::path::Path,
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

    let vault = match server::resolve_vault_path(vault) {
        Ok(path) => path,
        Err(error) => {
            return fail(format_args!(
                "the vault path could not be resolved: {error}"
            ));
        }
    };

    if allow_init {
        match init::initialize(&vault) {
            Ok(InitOutcome::Created { id }) => {
                tracing::info!(vault = %vault.display(), %id, "initialized the vault root");
            }
            Ok(InitOutcome::AlreadyInitialized { .. }) => {}
            Err(error) => return fail(format_args!("{error}")),
        }
    }

    let mut options = ServeOptions::new(&vault).with_address(bind, port);
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

        let snapshot = daemon.vault().snapshot();
        tracing::info!(
            vault = %options.vault.display(),
            url = %format_args!("http://{address}"),
            generation = snapshot.generation,
            bookmarks = snapshot.scan.bookmarks().count(),
            warnings = snapshot.scan.diagnostics().len(),
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
                println!("  created {}", bbb_vault_core::FOLDER_FILE_NAME);
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
            "  root metadata  MISSING — run `bbb init --vault {}`",
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

fn fail(message: std::fmt::Arguments<'_>) -> ExitCode {
    let mut stderr = io::stderr().lock();
    let _ = writeln!(stderr, "error: {message}");
    ExitCode::FAILURE
}
