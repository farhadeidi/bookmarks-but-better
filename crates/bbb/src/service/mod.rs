//! User-level service installation: no administrator, one vault, loopback only.
//!
//! # What is here and what is not
//!
//! This module is split deliberately into two halves:
//!
//! * **Generation and installation** — rendering a platform's service
//!   definition and putting it on disk idempotently. This half is complete and
//!   tested for all four definition formats on every platform, because it is
//!   pure text and file I/O and there is no excuse for it to be
//!   platform-dependent.
//! * **Process integration** — telling the platform's service manager to load,
//!   start, stop or report on what was installed. This half is wired for
//!   systemd, `launchctl` and `schtasks`. Only the Linux XDG-autostart
//!   fallback still returns [`ServiceError::Unwired`], and that is by design:
//!   an autostart entry has no supervisor to drive at all, so a
//!   `bbb service start` that printed "started" for one would be reporting a
//!   success that did not happen.
//!
//! # Safety properties
//!
//! * **Uninstall never deletes a vault.** Nothing in this module removes
//!   anything except the definition file it wrote. The vault path appears in a
//!   definition as text and is never used as a target for deletion.
//! * **An explicit port survives an upgrade.** Installing over an existing
//!   definition reads that definition's own command line back and reuses its
//!   port unless a new one was named, so a user who chose 47321 keeps it.
//! * **Loopback only.** [`ServiceSpec`] refuses a non-loopback bind at
//!   construction, so no generator can be handed one.
//! * **No bookmark content in logs.** A definition carries a command line and
//!   a log level. Titles and URLs are not in it, and the daemon does not log
//!   them at any level.

mod launchd;
mod manage;
mod quote;
mod spec;
mod systemd;
mod windows;
mod xdg;

use std::io;
use std::path::{Path, PathBuf};

pub use self::manage::{
    disable_and_stop, enable_and_start, preferred_kind, reload, start, state, stop,
    systemd_is_usable,
};
pub use self::spec::{
    SERVICE_DESCRIPTION, SERVICE_LABEL, SERVICE_NAME, ServiceSpec, SpecError, port_in, vault_in,
};
pub use self::windows::TASK_NAME;

/// Which kind of user-level service definition to write.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServiceKind {
    /// A systemd **user** unit, managed with `systemctl --user`.
    Systemd,
    /// An XDG autostart entry: started at login, never supervised.
    XdgAutostart,
    /// A macOS per-user `LaunchAgent`.
    LaunchAgent,
    /// A Windows Scheduled Task with a logon trigger.
    ScheduledTask,
}

impl ServiceKind {
    /// The kind this platform uses, before checking whether it is available.
    ///
    /// Linux answers [`Self::Systemd`]; [`Self::XdgAutostart`] is the fallback
    /// chosen by [`preferred_kind`] when systemd is not there.
    #[must_use]
    pub const fn for_this_platform() -> Self {
        #[cfg(target_os = "linux")]
        {
            Self::Systemd
        }
        #[cfg(target_os = "macos")]
        {
            Self::LaunchAgent
        }
        #[cfg(windows)]
        {
            Self::ScheduledTask
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
        {
            Self::XdgAutostart
        }
    }

    /// Whether this crate can actually drive the platform's service manager
    /// for this kind, as opposed to only writing its definition file.
    ///
    /// Every kind but [`Self::XdgAutostart`] is wired: systemd through
    /// `systemctl --user`, [`Self::LaunchAgent`] through `launchctl`, and
    /// [`Self::ScheduledTask`] through `schtasks`. An autostart entry has
    /// nothing to drive — it is started once at login by the desktop
    /// session, with no supervisor to ask about it — so it stays unwired by
    /// design, not because the integration is missing.
    #[must_use]
    pub const fn is_wired(self) -> bool {
        !matches!(self, Self::XdgAutostart)
    }

    /// A human name for messages.
    #[must_use]
    pub const fn describe(self) -> &'static str {
        match self {
            Self::Systemd => "systemd user service",
            Self::XdgAutostart => "XDG autostart entry",
            Self::LaunchAgent => "macOS LaunchAgent",
            Self::ScheduledTask => "Windows scheduled task",
        }
    }

    /// Renders the definition file for `spec`.
    #[must_use]
    pub fn definition(self, spec: &ServiceSpec) -> String {
        match self {
            Self::Systemd => systemd::unit(spec),
            Self::XdgAutostart => xdg::desktop_entry(spec),
            Self::LaunchAgent => launchd::plist(spec),
            Self::ScheduledTask => windows::task(spec),
        }
    }

    /// The bytes to write for a definition.
    ///
    /// Only Windows differs: `schtasks /Create /XML` rejects a UTF-8 file.
    #[must_use]
    pub fn definition_bytes(self, spec: &ServiceSpec) -> Vec<u8> {
        let text = self.definition(spec);
        match self {
            Self::ScheduledTask => windows::utf16le_bytes(&text),
            _ => text.into_bytes(),
        }
    }

    /// Recovers the command line an existing definition runs.
    #[must_use]
    pub fn command_line_in(self, definition: &str) -> Option<Vec<String>> {
        match self {
            Self::Systemd => systemd::command_line(definition),
            Self::XdgAutostart => xdg::command_line(definition),
            Self::LaunchAgent => launchd::command_line(definition),
            Self::ScheduledTask => windows::command_line(definition),
        }
    }

    const fn file_name(self) -> &'static str {
        match self {
            Self::Systemd => systemd::UNIT_FILE,
            Self::XdgAutostart => xdg::DESKTOP_FILE,
            Self::LaunchAgent => launchd::PLIST_FILE,
            Self::ScheduledTask => windows::TASK_FILE,
        }
    }
}

/// Where a user's service definitions live.
///
/// Rooted at an explicit home directory rather than read from the environment
/// on every call, so that a test can install into a temporary directory and
/// assert on real files without touching the machine it runs on.
#[derive(Debug, Clone)]
pub struct ServiceLayout {
    home: PathBuf,
    config_home: PathBuf,
}

impl ServiceLayout {
    /// A layout rooted at `home`, using the XDG default config directory.
    #[must_use]
    pub fn rooted_at(home: impl Into<PathBuf>) -> Self {
        let home = home.into();
        let config_home = home.join(".config");
        Self { home, config_home }
    }

    /// A layout from the environment: `$HOME` and `$XDG_CONFIG_HOME`.
    ///
    /// # Errors
    ///
    /// Returns [`ServiceError::NoHome`] when the home directory is unknown,
    /// which is the one case where guessing would put a definition file
    /// somewhere the user never looks.
    pub fn from_env() -> Result<Self, ServiceError> {
        let home = home_directory().ok_or(ServiceError::NoHome)?;
        let config_home = std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .unwrap_or_else(|| home.join(".config"));
        Ok(Self { home, config_home })
    }

    /// Where the definition file for `kind` belongs.
    #[must_use]
    pub fn definition_path(&self, kind: ServiceKind) -> PathBuf {
        match kind {
            ServiceKind::Systemd => self
                .config_home
                .join("systemd")
                .join("user")
                .join(kind.file_name()),
            ServiceKind::XdgAutostart => self.config_home.join("autostart").join(kind.file_name()),
            ServiceKind::LaunchAgent => self
                .home
                .join("Library")
                .join("LaunchAgents")
                .join(kind.file_name()),
            // Not a location the scheduler reads: `schtasks` imports from a
            // file and keeps its own copy, so this is where the definition we
            // registered is kept for comparison on upgrade.
            ServiceKind::ScheduledTask => self.config_home.join("bbb").join(kind.file_name()),
        }
    }
}

fn home_directory() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from)
        && home.is_absolute()
    {
        return Some(home);
    }
    // Windows has no HOME; USERPROFILE is the equivalent.
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
}

/// What an install did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstallOutcome {
    /// No definition existed; one was written.
    Created(PathBuf),
    /// A definition existed and differed; it was replaced.
    Updated(PathBuf),
    /// A definition existed and already said exactly this. Nothing was written.
    Unchanged(PathBuf),
}

impl InstallOutcome {
    /// The definition file involved.
    #[must_use]
    pub fn path(&self) -> &Path {
        match self {
            Self::Created(path) | Self::Updated(path) | Self::Unchanged(path) => path,
        }
    }

    /// Whether anything was written.
    #[must_use]
    pub const fn wrote(&self) -> bool {
        matches!(self, Self::Created(_) | Self::Updated(_))
    }
}

/// What `bbb service status` found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServiceState {
    /// No definition file is installed.
    NotInstalled,
    /// Installed and the service manager reports it running.
    Running,
    /// Installed and the service manager reports it not running.
    Stopped,
    /// Installed, but this kind has no supervision to ask.
    ///
    /// An XDG autostart entry is the case: it is started once at login and
    /// nothing tracks it afterwards.
    InstalledUnsupervised,
}

/// Why a service operation failed.
#[derive(Debug)]
#[non_exhaustive]
pub enum ServiceError {
    /// The home directory could not be determined.
    NoHome,
    /// A definition file could not be read or written.
    Io {
        /// The path that failed.
        path: PathBuf,
        /// The underlying error.
        error: io::Error,
    },
    /// The spec itself is not installable.
    Spec(SpecError),
    /// This crate can write this kind's definition but cannot drive its
    /// service manager yet.
    Unwired {
        /// The kind whose process integration is missing.
        kind: ServiceKind,
        /// What the user must do by hand in the meantime.
        instead: &'static str,
    },
    /// The platform's service tool failed.
    Tool {
        /// The command that was run.
        command: String,
        /// Its combined output, trimmed.
        output: String,
    },
}

impl core::fmt::Display for ServiceError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::NoHome => f.write_str(
                "the home directory is unknown, so there is nowhere a user service could be installed",
            ),
            Self::Io { path, error } => {
                write!(f, "{} could not be written: {error}", path.display())
            }
            Self::Spec(error) => write!(f, "{error}"),
            Self::Unwired { kind, instead } => write!(
                f,
                "installing a {} is supported, but starting and stopping one from `bbb` is not implemented yet; {instead}",
                kind.describe()
            ),
            Self::Tool { command, output } => {
                write!(f, "`{command}` failed: {output}")
            }
        }
    }
}

impl core::error::Error for ServiceError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Self::Io { error, .. } => Some(error),
            Self::Spec(error) => Some(error),
            _ => None,
        }
    }
}

impl From<SpecError> for ServiceError {
    fn from(error: SpecError) -> Self {
        Self::Spec(error)
    }
}

/// Installs — or re-installs — the definition for `kind`.
///
/// Idempotent by content: an install that would write exactly what is already
/// there reports [`InstallOutcome::Unchanged`] and touches nothing, so running
/// it twice is not a reason for a service manager to reload.
///
/// # Errors
///
/// [`ServiceError::Io`] when the definition cannot be written.
pub fn install(
    layout: &ServiceLayout,
    kind: ServiceKind,
    spec: &ServiceSpec,
) -> Result<InstallOutcome, ServiceError> {
    let path = layout.definition_path(kind);
    let desired = kind.definition_bytes(spec);

    let existing = match std::fs::read(&path) {
        Ok(bytes) => Some(bytes),
        Err(error) if error.kind() == io::ErrorKind::NotFound => None,
        Err(error) => {
            return Err(ServiceError::Io {
                path: path.clone(),
                error,
            });
        }
    };

    if existing.as_deref() == Some(desired.as_slice()) {
        return Ok(InstallOutcome::Unchanged(path));
    }

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| ServiceError::Io {
            path: parent.to_path_buf(),
            error,
        })?;
    }
    std::fs::write(&path, &desired).map_err(|error| ServiceError::Io {
        path: path.clone(),
        error,
    })?;

    Ok(if existing.is_some() {
        InstallOutcome::Updated(path)
    } else {
        InstallOutcome::Created(path)
    })
}

/// The command line an installed definition runs, if one is installed.
#[must_use]
pub fn installed_command_line(layout: &ServiceLayout, kind: ServiceKind) -> Option<Vec<String>> {
    let bytes = std::fs::read(layout.definition_path(kind)).ok()?;
    let text = match kind {
        ServiceKind::ScheduledTask => decode_utf16le(&bytes)?,
        _ => String::from_utf8(bytes).ok()?,
    };
    kind.command_line_in(&text)
}

fn decode_utf16le(bytes: &[u8]) -> Option<String> {
    let body = bytes.strip_prefix(&[0xFF, 0xFE]).unwrap_or(bytes);
    if !body.len().is_multiple_of(2) {
        return None;
    }
    let units: Vec<u16> = body
        .chunks_exact(2)
        .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&units).ok()
}

/// The port an install should use, given what the user asked for.
///
/// An explicitly requested port always wins. Otherwise the port already
/// installed is kept — that is the whole of "an upgrade preserves an existing
/// explicit port" — and only a fresh install falls back to the default.
#[must_use]
pub fn resolve_port(layout: &ServiceLayout, kind: ServiceKind, requested: Option<u16>) -> u16 {
    if let Some(port) = requested {
        return port;
    }
    installed_command_line(layout, kind)
        .as_deref()
        .and_then(port_in)
        .unwrap_or(crate::server::DEFAULT_PORT)
}

/// The vault an installed definition serves, if one is installed.
///
/// `bbb service install` requires `--vault` explicitly, exactly as every other
/// subcommand does. This exists so that `status` can *report* which vault is
/// being served — never so that a command can default to it.
#[must_use]
pub fn installed_vault(layout: &ServiceLayout, kind: ServiceKind) -> Option<PathBuf> {
    installed_command_line(layout, kind)
        .as_deref()
        .and_then(vault_in)
}

/// Removes the definition file, and nothing else.
///
/// Returns whether a file was there to remove. **The vault is never touched**:
/// this deletes one generated file whose path this module chose, and a vault
/// path is data inside that file, not a target.
///
/// # Errors
///
/// [`ServiceError::Io`] when the file exists but cannot be removed.
pub fn uninstall(layout: &ServiceLayout, kind: ServiceKind) -> Result<bool, ServiceError> {
    let path = layout.definition_path(kind);
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(ServiceError::Io { path, error }),
    }
}

/// Whether a definition for `kind` is installed.
#[must_use]
pub fn is_installed(layout: &ServiceLayout, kind: ServiceKind) -> bool {
    layout.definition_path(kind).exists()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::{IpAddr, Ipv4Addr};

    fn spec(vault: &str, port: u16) -> ServiceSpec {
        ServiceSpec::unchecked("/usr/local/bin/bbb", vault)
            .with_port(port)
            .expect("valid port")
    }

    const KINDS: &[ServiceKind] = &[
        ServiceKind::Systemd,
        ServiceKind::XdgAutostart,
        ServiceKind::LaunchAgent,
        ServiceKind::ScheduledTask,
    ];

    #[test]
    fn every_kind_writes_a_definition_that_reads_back_as_what_it_runs() {
        for &kind in KINDS {
            let home = tempfile::tempdir().expect("temp dir");
            let layout = ServiceLayout::rooted_at(home.path());
            let spec = spec("/home/user/My Bookmarks 书签", 47321);

            let outcome = install(&layout, kind, &spec).expect("install");
            assert!(matches!(outcome, InstallOutcome::Created(_)), "{kind:?}");
            assert!(outcome.path().is_file(), "{kind:?}");

            let parsed = installed_command_line(&layout, kind).expect("read back");
            assert_eq!(parsed, spec.command_line(), "{kind:?}");
            assert_eq!(port_in(&parsed), Some(47321), "{kind:?}");
            assert_eq!(
                installed_vault(&layout, kind),
                Some(PathBuf::from("/home/user/My Bookmarks 书签")),
                "{kind:?}"
            );
        }
    }

    #[test]
    fn installing_the_same_thing_twice_writes_nothing_the_second_time() {
        for &kind in KINDS {
            let home = tempfile::tempdir().expect("temp dir");
            let layout = ServiceLayout::rooted_at(home.path());
            let spec = spec("/home/user/Vault", 52222);

            assert!(install(&layout, kind, &spec).expect("first").wrote());
            let second = install(&layout, kind, &spec).expect("second");

            assert_eq!(
                second,
                InstallOutcome::Unchanged(layout.definition_path(kind)),
                "{kind:?}"
            );
            assert!(!second.wrote(), "{kind:?}");
        }
    }

    #[test]
    fn an_upgrade_preserves_an_explicitly_configured_port() {
        for &kind in KINDS {
            let home = tempfile::tempdir().expect("temp dir");
            let layout = ServiceLayout::rooted_at(home.path());

            // An installation from before the default moved.
            install(&layout, kind, &spec("/home/user/Vault", 47321)).expect("install");

            // An upgrade that names no port keeps the one that is there.
            assert_eq!(resolve_port(&layout, kind, None), 47321, "{kind:?}");

            // And an upgrade that *does* name one is obeyed.
            assert_eq!(resolve_port(&layout, kind, Some(40404)), 40404, "{kind:?}");
        }
    }

    #[test]
    fn a_fresh_install_uses_the_current_default_port() {
        for &kind in KINDS {
            let home = tempfile::tempdir().expect("temp dir");
            let layout = ServiceLayout::rooted_at(home.path());
            assert_eq!(resolve_port(&layout, kind, None), 52222, "{kind:?}");
        }
    }

    #[test]
    fn an_upgrade_rewrites_the_definition_when_it_differs() {
        let home = tempfile::tempdir().expect("temp dir");
        let layout = ServiceLayout::rooted_at(home.path());
        let kind = ServiceKind::Systemd;

        install(&layout, kind, &spec("/home/user/Vault", 47321)).expect("install");
        let upgraded = install(&layout, kind, &spec("/home/user/Vault", 40404)).expect("upgrade");

        assert!(matches!(upgraded, InstallOutcome::Updated(_)));
        assert_eq!(
            port_in(&installed_command_line(&layout, kind).expect("read back")),
            Some(40404)
        );
    }

    #[test]
    fn uninstall_removes_the_definition_and_never_the_vault() {
        for &kind in KINDS {
            let home = tempfile::tempdir().expect("temp dir");
            let layout = ServiceLayout::rooted_at(home.path());

            // A real directory standing in for the user's vault, with a file
            // in it, so that "the vault survived" is a claim about content.
            let vault = home.path().join("My Vault");
            std::fs::create_dir_all(&vault).expect("create vault");
            let bookmark = vault.join("Example--a1b2c3d4.md");
            std::fs::write(&bookmark, "---\nbbb_id: a1b2c3d4\n---\n").expect("write");

            let spec = ServiceSpec::unchecked("/usr/local/bin/bbb", &vault.to_string_lossy());
            install(&layout, kind, &spec).expect("install");

            assert!(uninstall(&layout, kind).expect("uninstall"), "{kind:?}");

            assert!(!layout.definition_path(kind).exists(), "{kind:?}");
            assert!(vault.is_dir(), "the vault directory survives: {kind:?}");
            assert!(bookmark.is_file(), "its contents survive: {kind:?}");
        }
    }

    #[test]
    fn uninstalling_twice_is_not_an_error() {
        let home = tempfile::tempdir().expect("temp dir");
        let layout = ServiceLayout::rooted_at(home.path());
        let kind = ServiceKind::Systemd;

        install(&layout, kind, &spec("/home/user/Vault", 52222)).expect("install");
        assert!(uninstall(&layout, kind).expect("first"));
        assert!(
            !uninstall(&layout, kind).expect("second"),
            "a second uninstall reports nothing to do rather than failing"
        );
    }

    #[test]
    fn definitions_land_in_the_conventional_place_for_each_platform() {
        let home = PathBuf::from("test-home");
        let layout = ServiceLayout::rooted_at(&home);

        assert_eq!(
            layout.definition_path(ServiceKind::Systemd),
            home.join(".config/systemd/user/bbb.service")
        );
        assert_eq!(
            layout.definition_path(ServiceKind::XdgAutostart),
            home.join(".config/autostart/bbb.desktop")
        );
        assert_eq!(
            layout.definition_path(ServiceKind::LaunchAgent),
            home.join("Library/LaunchAgents/com.bookmarksbutbetter.bbb.plist")
        );
        assert_eq!(
            layout.definition_path(ServiceKind::ScheduledTask),
            home.join(".config/bbb/bbb-task.xml")
        );
    }

    #[test]
    fn no_definition_can_be_generated_for_a_non_loopback_bind() {
        let error = spec("/home/user/Vault", 52222)
            .with_bind(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
            .expect_err("0.0.0.0 is refused before any generator sees it");
        assert!(matches!(error, SpecError::NotLoopback { .. }));
    }

    #[test]
    fn every_generated_definition_binds_loopback() {
        for &kind in KINDS {
            let text = kind.definition(&spec("/home/user/Vault", 52222));
            let parsed = kind.command_line_in(&text).expect("parse");
            let bind = parsed
                .iter()
                .position(|argument| argument == "--bind")
                .and_then(|index| parsed.get(index + 1))
                .expect("a --bind argument");
            assert_eq!(bind, "127.0.0.1", "{kind:?}");
        }
    }

    #[test]
    fn every_kind_but_autostart_claims_to_be_wired() {
        for &kind in &[
            ServiceKind::Systemd,
            ServiceKind::LaunchAgent,
            ServiceKind::ScheduledTask,
        ] {
            assert!(kind.is_wired(), "{kind:?} must claim its real integration");
        }
        assert!(
            !ServiceKind::XdgAutostart.is_wired(),
            "an autostart entry has nothing to drive, by design"
        );
    }

    #[test]
    fn reading_back_an_absent_definition_yields_nothing() {
        let home = tempfile::tempdir().expect("temp dir");
        let layout = ServiceLayout::rooted_at(home.path());

        for &kind in KINDS {
            assert!(!is_installed(&layout, kind), "{kind:?}");
            assert_eq!(installed_command_line(&layout, kind), None, "{kind:?}");
            assert_eq!(installed_vault(&layout, kind), None, "{kind:?}");
        }
    }
}
