//! What a generated service definition has to say.

use std::net::IpAddr;
use std::path::{Path, PathBuf};

use crate::server::{DEFAULT_BIND, DEFAULT_PORT};

/// The reverse-DNS identifier the macOS agent uses, and the stem every other
/// platform's definition file is named after.
pub const SERVICE_LABEL: &str = "com.bookmarksbutbetter.bbb";

/// The systemd unit / desktop entry / task name, without an extension.
pub const SERVICE_NAME: &str = "bbb";

/// A one-line description, shown by every platform's service tooling.
pub const SERVICE_DESCRIPTION: &str = "Bookmarks But Better daemon";

/// Everything a service definition needs in order to start the daemon.
///
/// The vault path is stored *absolute and verbatim*. A service is started by
/// the system with no shell, no working directory the user chose and no
/// environment they set, so a relative path or one relying on `~` would
/// resolve somewhere they never intended — which for a daemon that writes
/// files is the difference between "did not start" and "wrote into the wrong
/// directory".
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ServiceSpec {
    /// The absolute path of the `bbb` binary to run.
    pub exe: PathBuf,
    /// The absolute path of the vault to serve.
    pub vault: PathBuf,
    /// The address to bind. Loopback only, enforced at construction.
    pub bind: IpAddr,
    /// The port to bind.
    pub port: u16,
    /// A directory holding the built web UI, if the service should serve it.
    pub ui_dir: Option<PathBuf>,
}

/// Why a spec could not be built.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum SpecError {
    /// A path that must be absolute was not.
    RelativePath {
        /// Which path: `exe`, `vault` or `ui-dir`.
        what: &'static str,
        /// The path as given.
        path: PathBuf,
    },
    /// The bind address is not loopback.
    NotLoopback {
        /// The address as given.
        bind: IpAddr,
    },
    /// Port 0 asks the OS for a free port, which a service definition cannot use.
    EphemeralPort,
}

impl core::fmt::Display for SpecError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::RelativePath { what, path } => write!(
                f,
                "the {what} path {} must be absolute: a service is started with no working directory of yours",
                path.display()
            ),
            Self::NotLoopback { bind } => write!(
                f,
                "--bind {bind} is not a loopback address; this milestone serves loopback clients only"
            ),
            Self::EphemeralPort => f.write_str(
                "--port 0 asks the operating system for any free port, so a service installed with it would move every restart and no browser could find it",
            ),
        }
    }
}

impl core::error::Error for SpecError {}

impl ServiceSpec {
    /// Builds a spec, refusing anything a service manager could not honour.
    ///
    /// # Errors
    ///
    /// [`SpecError::RelativePath`] for a non-absolute path,
    /// [`SpecError::NotLoopback`] for a bind address that is not loopback, and
    /// [`SpecError::EphemeralPort`] for port 0.
    pub fn new(exe: impl Into<PathBuf>, vault: impl Into<PathBuf>) -> Result<Self, SpecError> {
        let exe = exe.into();
        let vault = vault.into();
        require_absolute("executable", &exe)?;
        require_absolute("vault", &vault)?;
        Ok(Self {
            exe,
            vault,
            bind: DEFAULT_BIND,
            port: DEFAULT_PORT,
            ui_dir: None,
        })
    }

    /// Sets the port.
    ///
    /// # Errors
    ///
    /// [`SpecError::EphemeralPort`] when `port` is 0.
    pub fn with_port(mut self, port: u16) -> Result<Self, SpecError> {
        if port == 0 {
            return Err(SpecError::EphemeralPort);
        }
        self.port = port;
        Ok(self)
    }

    /// Sets the bind address.
    ///
    /// # Errors
    ///
    /// [`SpecError::NotLoopback`] when `bind` is not a loopback address. This
    /// is the same refusal `bbb serve` makes, repeated here because a service
    /// definition is written once and read by the system forever after: a
    /// non-loopback bind smuggled in here would outlive any interactive
    /// warning.
    pub fn with_bind(mut self, bind: IpAddr) -> Result<Self, SpecError> {
        if !bind.is_loopback() {
            return Err(SpecError::NotLoopback { bind });
        }
        self.bind = bind;
        Ok(self)
    }

    /// Sets the UI directory to serve.
    ///
    /// # Errors
    ///
    /// [`SpecError::RelativePath`] when the directory is not absolute.
    pub fn with_ui_dir(mut self, ui_dir: impl Into<PathBuf>) -> Result<Self, SpecError> {
        let ui_dir = ui_dir.into();
        require_absolute("ui-dir", &ui_dir)?;
        self.ui_dir = Some(ui_dir);
        Ok(self)
    }

    /// The full command line, executable first.
    ///
    /// This is the single definition of what a service runs; every generator
    /// formats *this* rather than assembling its own, so the platforms cannot
    /// drift apart in what they actually start.
    #[must_use]
    pub fn command_line(&self) -> Vec<String> {
        let mut args = vec![
            self.exe.to_string_lossy().into_owned(),
            "serve".to_owned(),
            "--vault".to_owned(),
            self.vault.to_string_lossy().into_owned(),
            "--bind".to_owned(),
            self.bind.to_string(),
            "--port".to_owned(),
            self.port.to_string(),
        ];
        if let Some(ui_dir) = &self.ui_dir {
            args.push("--ui-dir".to_owned());
            args.push(ui_dir.to_string_lossy().into_owned());
        }
        args
    }

    /// The arguments only, without the executable.
    #[must_use]
    pub fn arguments(&self) -> Vec<String> {
        self.command_line().split_off(1)
    }
}

impl ServiceSpec {
    /// Builds a spec without the absoluteness check.
    ///
    /// `Path::is_absolute` answers for the *host*, so `C:\…` is not absolute
    /// on Linux and `/…` is not absolute on Windows. The generators are pure
    /// text and must be testable for every platform's format from any host —
    /// that is the whole claim the module documentation makes — so the tests
    /// that render another platform's definition build their specs here.
    #[cfg(test)]
    pub(crate) fn unchecked(exe: &str, vault: &str) -> Self {
        Self {
            exe: PathBuf::from(exe),
            vault: PathBuf::from(vault),
            bind: DEFAULT_BIND,
            port: DEFAULT_PORT,
            ui_dir: None,
        }
    }
}

fn require_absolute(what: &'static str, path: &Path) -> Result<(), SpecError> {
    if path.is_absolute() {
        Ok(())
    } else {
        Err(SpecError::RelativePath {
            what,
            path: path.to_path_buf(),
        })
    }
}

/// The port named by `--port` in a parsed command line.
///
/// This is how an upgrade preserves a port the user configured: the existing
/// definition is read back and its own value reused, rather than a stored
/// default being re-applied over the top of a deliberate choice.
#[must_use]
pub fn port_in(arguments: &[String]) -> Option<u16> {
    value_of(arguments, "--port").and_then(|text| text.parse().ok())
}

/// The vault named by `--vault` in a parsed command line.
#[must_use]
pub fn vault_in(arguments: &[String]) -> Option<PathBuf> {
    value_of(arguments, "--vault").map(PathBuf::from)
}

fn value_of<'a>(arguments: &'a [String], flag: &str) -> Option<&'a str> {
    arguments
        .iter()
        .position(|argument| argument == flag)
        .and_then(|index| arguments.get(index + 1))
        .map(String::as_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::Ipv4Addr;

    fn spec() -> ServiceSpec {
        ServiceSpec::new("/usr/local/bin/bbb", "/home/user/My Bookmarks").expect("absolute paths")
    }

    #[test]
    fn the_command_line_defaults_to_loopback_and_52222() {
        assert_eq!(
            spec().command_line(),
            vec![
                "/usr/local/bin/bbb",
                "serve",
                "--vault",
                "/home/user/My Bookmarks",
                "--bind",
                "127.0.0.1",
                "--port",
                "52222",
            ]
        );
    }

    #[test]
    fn a_relative_path_is_refused_for_the_vault_and_the_executable() {
        assert!(matches!(
            ServiceSpec::new("bbb", "/home/user/Vault"),
            Err(SpecError::RelativePath {
                what: "executable",
                ..
            })
        ));
        assert!(matches!(
            ServiceSpec::new("/usr/local/bin/bbb", "Vault"),
            Err(SpecError::RelativePath { what: "vault", .. })
        ));
    }

    #[test]
    fn a_non_loopback_bind_is_refused_even_here() {
        let error = spec()
            .with_bind(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
            .expect_err("0.0.0.0 is not loopback");
        assert!(matches!(error, SpecError::NotLoopback { .. }));
    }

    #[test]
    fn an_ephemeral_port_is_refused() {
        assert_eq!(spec().with_port(0), Err(SpecError::EphemeralPort));
    }

    #[test]
    fn a_ui_directory_is_appended_only_when_set() {
        assert!(!spec().command_line().contains(&"--ui-dir".to_owned()));
        let served = spec().with_ui_dir("/opt/bbb/ui").expect("absolute");
        assert!(served.command_line().contains(&"--ui-dir".to_owned()));
        assert!(served.command_line().contains(&"/opt/bbb/ui".to_owned()));
    }

    #[test]
    fn the_port_and_vault_are_recoverable_from_a_command_line() {
        let configured = spec().with_port(47321).expect("valid port");
        let arguments = configured.arguments();

        assert_eq!(port_in(&arguments), Some(47321));
        assert_eq!(
            vault_in(&arguments),
            Some(PathBuf::from("/home/user/My Bookmarks"))
        );
    }

    #[test]
    fn a_command_line_without_the_flag_yields_nothing_rather_than_a_default() {
        // A caller that cannot find the old port must know it, not be handed
        // 52222 and told the user chose it.
        assert_eq!(port_in(&["serve".to_owned()]), None);
        assert_eq!(port_in(&["--port".to_owned()]), None);
        assert_eq!(vault_in(&["serve".to_owned()]), None);
    }
}
