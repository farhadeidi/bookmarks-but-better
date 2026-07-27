//! Putting the daemon together: lock, vault, router, watcher, shutdown.

use std::io;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::Router;
use tokio::net::TcpListener;

use crate::api::{self, ApiState};
use crate::host;
use crate::lock::{LockError, VaultLock};
use crate::ui;
use crate::vault::Vault;
use crate::watch::{self, WatchHandle, WatchOptions};

/// The path prefix every API route lives under.
pub const API_PREFIX: &str = "/api/v1";

/// The default loopback address the daemon binds to.
pub const DEFAULT_BIND: IpAddr = IpAddr::V4(std::net::Ipv4Addr::LOCALHOST);
/// The default port.
pub const DEFAULT_PORT: u16 = 47321;

/// Everything needed to start serving.
#[derive(Debug, Clone)]
pub struct ServeOptions {
    /// The vault to serve. Nothing outside this directory is ever read.
    pub vault: PathBuf,
    /// The address to bind. Loopback only in this milestone.
    pub bind: IpAddr,
    /// The port to bind; `0` asks the operating system for a free one.
    pub port: u16,
    /// A directory holding the built web UI, if one should be served.
    pub ui_dir: Option<PathBuf>,
    /// Watcher tuning.
    pub watch: WatchOptions,
}

impl Default for ServeOptions {
    fn default() -> Self {
        Self {
            vault: PathBuf::new(),
            bind: DEFAULT_BIND,
            port: DEFAULT_PORT,
            ui_dir: None,
            watch: WatchOptions::default(),
        }
    }
}

impl ServeOptions {
    /// Options for serving `vault` with every default.
    #[must_use]
    pub fn new(vault: impl Into<PathBuf>) -> Self {
        Self {
            vault: vault.into(),
            ..Self::default()
        }
    }

    /// Sets the UI directory.
    #[must_use]
    pub fn with_ui_dir(mut self, directory: impl Into<PathBuf>) -> Self {
        self.ui_dir = Some(directory.into());
        self
    }

    /// Sets the bind address and port.
    #[must_use]
    pub const fn with_address(mut self, bind: IpAddr, port: u16) -> Self {
        self.bind = bind;
        self.port = port;
        self
    }
}

/// An open vault with a router in front of it.
///
/// Holding one of these means holding the vault's lock. Dropping it releases
/// the lock, so a test that builds a daemon per temporary vault cannot leak a
/// claim into the next test.
#[derive(Debug)]
pub struct Daemon {
    vault: Arc<Vault>,
    router: Router,
    // Dropped last-but-one; the lock is what other processes see.
    _lock: VaultLock,
}

impl Daemon {
    /// Locks the vault, scans it, and builds the router.
    ///
    /// The vault must already be initialized; use [`crate::init::initialize`]
    /// first. This refusal is deliberate — a daemon that initialized whatever
    /// directory it was pointed at would write a file into a mistyped path.
    ///
    /// # Errors
    ///
    /// [`StartError::NotAVault`] when the root has no `.bbb-folder.md`,
    /// [`StartError::Locked`] when another daemon holds it,
    /// [`StartError::Vault`] when it cannot be scanned, and
    /// [`StartError::UiDir`] when the UI directory has no `index.html`.
    pub fn open(options: &ServeOptions) -> Result<Self, StartError> {
        let lock = VaultLock::acquire(&options.vault).map_err(|error| match error {
            held @ LockError::Held { .. } => StartError::Locked(held),
            LockError::Io { path, error } => StartError::Vault { path, error },
        })?;

        let vault = Vault::open(&options.vault).map_err(|error| StartError::Vault {
            path: options.vault.clone(),
            error,
        })?;
        if vault.snapshot().scan.folder().id().is_none() {
            return Err(StartError::NotAVault {
                path: options.vault.clone(),
            });
        }
        let vault = Arc::new(vault);

        let api = api::router(ApiState {
            vault: Arc::clone(&vault),
        });
        let mut router = Router::new().nest(API_PREFIX, api);

        if let Some(directory) = &options.ui_dir {
            let service = ui::service(directory).ok_or_else(|| StartError::UiDir {
                path: directory.clone(),
            })?;
            router = router.merge(service);
        } else {
            // With no UI to serve, a non-API path is simply not a route here.
            router = router.fallback(api::unknown_route);
        }

        let router = router.layer(axum::middleware::from_fn(host::guard));

        Ok(Self {
            vault,
            router,
            _lock: lock,
        })
    }

    /// The router, for tests that drive it without binding a socket.
    pub fn router(&self) -> Router {
        self.router.clone()
    }

    /// The vault being served.
    #[must_use]
    pub fn vault(&self) -> &Arc<Vault> {
        &self.vault
    }

    /// Starts the watcher for this vault.
    #[must_use]
    pub fn watch(&self, options: WatchOptions) -> WatchHandle {
        watch::spawn(Arc::clone(&self.vault), options)
    }

    /// Serves until `shutdown` resolves, then drains in-flight requests.
    ///
    /// # Errors
    ///
    /// Returns any I/O error from accepting connections.
    pub async fn serve(
        self,
        listener: TcpListener,
        shutdown: impl Future<Output = ()> + Send + 'static,
        watch_options: WatchOptions,
    ) -> io::Result<()> {
        let watcher = self.watch(watch_options);
        let router = self.router();

        let result = axum::serve(listener, router)
            .with_graceful_shutdown(shutdown)
            .await;

        // The watcher is stopped after the server so that a rescan triggered by
        // the last request still completes.
        watcher.shutdown().await;
        result
    }
}

/// Binds the configured address.
///
/// # Errors
///
/// Returns the bind error, which is most often "address already in use".
pub async fn bind(options: &ServeOptions) -> io::Result<TcpListener> {
    TcpListener::bind(SocketAddr::new(options.bind, options.port)).await
}

/// Why the daemon could not start.
#[derive(Debug)]
#[non_exhaustive]
pub enum StartError {
    /// The directory is not an initialized vault.
    NotAVault {
        /// The directory that was pointed at.
        path: PathBuf,
    },
    /// Another process holds the vault.
    Locked(LockError),
    /// The vault could not be read.
    Vault {
        /// The path that failed.
        path: PathBuf,
        /// The underlying error.
        error: io::Error,
    },
    /// The UI directory cannot serve a single-page application.
    UiDir {
        /// The directory that was given.
        path: PathBuf,
    },
}

impl core::fmt::Display for StartError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::NotAVault { path } => write!(
                f,
                "{} is not an initialized vault (no {} at its root)\n         run: bbb init --vault {}\n         or:  bbb serve --vault {} --init",
                path.display(),
                bbb_vault_core::FOLDER_FILE_NAME,
                path.display(),
                path.display(),
            ),
            Self::Locked(error) => write!(f, "{error}"),
            Self::Vault { path, error } => {
                write!(
                    f,
                    "the vault {} could not be opened: {error}",
                    path.display()
                )
            }
            Self::UiDir { path } => write!(
                f,
                "the ui directory {} has no index.html, so it cannot serve the web app",
                path.display()
            ),
        }
    }
}

impl core::error::Error for StartError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Self::Locked(error) => Some(error),
            Self::Vault { error, .. } => Some(error),
            Self::NotAVault { .. } | Self::UiDir { .. } => None,
        }
    }
}

/// Resolves the vault path a command was given, without following it anywhere.
///
/// Only absolute-ising is done here. Canonicalisation is avoided on purpose: it
/// resolves symbolic links, which would turn a symlinked vault root — something
/// the scanner refuses outright — into its target and quietly accept it.
///
/// # Errors
///
/// Returns an error when the current directory cannot be read.
pub fn resolve_vault_path(path: &Path) -> io::Result<PathBuf> {
    std::path::absolute(path)
}
