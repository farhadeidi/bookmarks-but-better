//! Driving the platform's service manager.
//!
//! Every kind's definition can be *written* — that half is complete and tested
//! for all four — and now every kind except [`ServiceKind::XdgAutostart`] can
//! also be told to load, start, stop or report on it: systemd through
//! `systemctl --user`, the macOS agent through `launchctl`, and the Windows
//! task through `schtasks`. An autostart entry has nothing to drive — it is
//! started once at login by the desktop session, with no supervisor to ask —
//! so [`ServiceError::Unwired`] is what it still returns, carrying the command
//! the user should run instead, rather than reporting a success that did not
//! happen.

use std::path::{Path, PathBuf};
use std::process::Command;

use super::{ServiceError, ServiceKind, ServiceLayout, ServiceState, is_installed};

/// The unit name `systemctl --user` is given.
const UNIT: &str = "bookmarks-but-better.service";

/// Whether `systemctl --user` can be used here.
///
/// Both halves matter: the binary has to exist, and there has to be a user
/// session bus to talk to. A container or an SSH session without lingering
/// enabled has the first and not the second, and installing a unit there would
/// produce a service that never starts.
#[must_use]
pub fn systemd_is_usable() -> bool {
    if std::env::var_os("XDG_RUNTIME_DIR").is_none() {
        return false;
    }
    Command::new("systemctl")
        .args(["--user", "--version"])
        .output()
        .is_ok_and(|output| output.status.success())
}

/// The kind to install on this platform, given what is actually available.
///
/// On Linux this is where the XDG fallback is chosen: an autostart entry is
/// strictly weaker — started once at login, never supervised, no restart on
/// failure — so it is used only when systemd is not an option at all.
#[must_use]
pub fn preferred_kind() -> ServiceKind {
    let kind = ServiceKind::for_this_platform();
    if kind == ServiceKind::Systemd && !systemd_is_usable() {
        return ServiceKind::XdgAutostart;
    }
    kind
}

fn tool_result(
    command: String,
    output: std::io::Result<std::process::Output>,
) -> Result<String, ServiceError> {
    let output = output.map_err(|error| ServiceError::Tool {
        command: command.clone(),
        output: error.to_string(),
    })?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if output.status.success() {
        return Ok(stdout);
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(ServiceError::Tool {
        command,
        output: if stderr.is_empty() { stdout } else { stderr },
    })
}

fn systemctl(arguments: &[&str]) -> Result<String, ServiceError> {
    let output = Command::new("systemctl")
        .arg("--user")
        .args(arguments)
        .output();
    tool_result(format!("systemctl --user {}", arguments.join(" ")), output)
}

fn xdg_autostart_unwired() -> ServiceError {
    ServiceError::Unwired {
        kind: ServiceKind::XdgAutostart,
        instead: "an autostart entry starts at your next login; run `bookmarks-but-better serve` directly until then",
    }
}

// ---------------------------------------------------------------------------
// macOS: launchctl
// ---------------------------------------------------------------------------

/// The numeric id of the user running this process, for the `gui/<uid>`
/// launchd domain target.
///
/// Shelled out to `id -u` rather than an FFI call to `getuid()`: the
/// workspace forbids `unsafe_code` outright, and this runs rarely enough
/// (once per service operation) that a process spawn is not a cost worth
/// avoiding for it.
fn current_uid() -> Result<String, ServiceError> {
    let output = Command::new("id").arg("-u").output();
    let uid = tool_result("id -u".to_owned(), output)?;
    if !uid.bytes().all(|byte| byte.is_ascii_digit()) || uid.is_empty() {
        return Err(ServiceError::Tool {
            command: "id -u".to_owned(),
            output: format!("expected a numeric user id, got {uid:?}"),
        });
    }
    Ok(uid)
}

fn launchd_domain() -> Result<String, ServiceError> {
    Ok(format!("gui/{}", current_uid()?))
}

fn launchctl(arguments: &[&str]) -> Result<String, ServiceError> {
    let output = Command::new("launchctl").args(arguments).output();
    tool_result(format!("launchctl {}", arguments.join(" ")), output)
}

/// Loads `plist_path` into the user's GUI domain, which — because every
/// generated agent sets `RunAtLoad` — is also what starts it.
///
/// Idempotent by way of unloading first: an agent already loaded is booted
/// out before the fresh bootstrap, so a changed plist is always the one
/// actually running afterward rather than whatever launchd cached at the
/// last login. The unload is best-effort — "not loaded yet" is the ordinary
/// first-install case, not a failure.
fn launchd_bootstrap(plist_path: &Path) -> Result<(), ServiceError> {
    let domain = launchd_domain()?;
    let path = plist_path.to_string_lossy();
    let _ = launchctl(&["bootout", &domain, &path]);
    launchctl(&["bootstrap", &domain, &path]).map(|_| ())
}

/// Unloads the agent at `plist_path`, stopping it. The plist file itself is
/// untouched, so a real login session reloads it again on its own — the same
/// "still enabled, just not running right now" a `systemctl stop` leaves
/// behind on an enabled unit.
fn launchd_bootout(plist_path: &Path) -> Result<(), ServiceError> {
    let domain = launchd_domain()?;
    launchctl(&["bootout", &domain, &plist_path.to_string_lossy()]).map(|_| ())
}

fn launchd_state(label: &str) -> Result<ServiceState, ServiceError> {
    let target = format!("{}/{label}", launchd_domain()?);
    let output = Command::new("launchctl")
        .args(["print", &target])
        .output()
        .map_err(|error| ServiceError::Tool {
            command: format!("launchctl print {target}"),
            output: error.to_string(),
        })?;
    if !output.status.success() {
        // Not currently loaded into the domain — the answer immediately after
        // `stop`, or before the first `start` since the last login. That is a
        // state, not a failure, exactly as a nonzero `systemctl is-active`.
        return Ok(ServiceState::Stopped);
    }
    Ok(parse_launchctl_print(&String::from_utf8_lossy(
        &output.stdout,
    )))
}

/// Every agent definition on disk, with the label it loads under: the current
/// one, and one from before 4.2.0 while it is still there.
fn launchd_definitions(layout: &ServiceLayout) -> Vec<(PathBuf, &'static str)> {
    let kind = ServiceKind::LaunchAgent;
    let current = layout.definition_path(kind);
    let mut definitions = Vec::new();
    if current.exists() {
        definitions.push((current, super::SERVICE_LABEL));
    }
    if let Some(legacy) = layout.installed_legacy_definition_path(kind) {
        definitions.push((legacy, super::launchd::LEGACY_LABEL));
    }
    definitions
}

/// Loads the installed agent. A definition from before 4.2.0 still sitting
/// next to the current one is retired first, because both claim the same port.
fn launchd_start(layout: &ServiceLayout) -> Result<(), ServiceError> {
    let kind = ServiceKind::LaunchAgent;
    if layout.definition_path(kind).exists() {
        retire_legacy(layout, kind)?;
    }
    launchd_bootstrap(&layout.active_definition_path(kind))
}

/// Unloads every agent definition on disk, trying them all before reporting
/// the first failure, so one that is not loaded cannot keep another running.
fn launchd_stop(layout: &ServiceLayout) -> Result<(), ServiceError> {
    let definitions = launchd_definitions(layout);
    if definitions.is_empty() {
        return launchd_bootout(&layout.definition_path(ServiceKind::LaunchAgent));
    }
    definitions
        .iter()
        .map(|(path, _)| launchd_bootout(path))
        .fold(Ok(()), Result::and)
}

/// Running when any agent definition on disk is running under its label.
fn launchd_installed_state(layout: &ServiceLayout) -> Result<ServiceState, ServiceError> {
    for (_, label) in launchd_definitions(layout) {
        if launchd_state(label)? == ServiceState::Running {
            return Ok(ServiceState::Running);
        }
    }
    Ok(ServiceState::Stopped)
}

/// Reads the `state = …` line out of `launchctl print`'s output.
fn parse_launchctl_print(output: &str) -> ServiceState {
    let running = output.lines().any(|line| {
        line.trim()
            .strip_prefix("state = ")
            .is_some_and(|state| state.starts_with("running"))
    });
    if running {
        ServiceState::Running
    } else {
        ServiceState::Stopped
    }
}

// ---------------------------------------------------------------------------
// Windows: schtasks
// ---------------------------------------------------------------------------

fn schtasks(arguments: &[&str]) -> Result<String, ServiceError> {
    let output = Command::new("schtasks").args(arguments).output();
    tool_result(format!("schtasks {}", arguments.join(" ")), output)
}

/// Registers (or re-registers) the task from `xml_path`.
///
/// `/F` makes this idempotent by overwriting rather than refusing a task that
/// is already registered. Registering does not run it — `schtasks /Create`
/// only schedules the logon trigger — which is exactly what lets this be
/// called from `reload` without also starting the service under `--no-start`.
fn schtasks_create(xml_path: &Path) -> Result<(), ServiceError> {
    schtasks(&[
        "/Create",
        "/XML",
        &xml_path.to_string_lossy(),
        "/TN",
        super::TASK_NAME,
        "/F",
    ])
    .map(|_| ())
}

fn schtasks_run() -> Result<(), ServiceError> {
    schtasks(&["/Run", "/TN", super::TASK_NAME]).map(|_| ())
}

fn schtasks_end() -> Result<(), ServiceError> {
    schtasks(&["/End", "/TN", super::TASK_NAME]).map(|_| ())
}

fn schtasks_delete() -> Result<(), ServiceError> {
    schtasks(&["/Delete", "/TN", super::TASK_NAME, "/F"]).map(|_| ())
}

fn schtasks_state() -> Result<ServiceState, ServiceError> {
    let output = Command::new("schtasks")
        .args(["/Query", "/TN", super::TASK_NAME, "/FO", "CSV", "/NH"])
        .output()
        .map_err(|error| ServiceError::Tool {
            command: format!("schtasks /Query /TN {}", super::TASK_NAME),
            output: error.to_string(),
        })?;
    if !output.status.success() {
        // Registered per our own definition file but not (or no longer) known
        // to the scheduler — reported as stopped rather than an error, same
        // reasoning as `launchd_state`.
        return Ok(ServiceState::Stopped);
    }
    Ok(parse_schtasks_csv(&String::from_utf8_lossy(&output.stdout)))
}

/// Splits one line of quoted CSV, honouring `""`-escaped quotes.
///
/// A naive split on `,` breaks the moment a field contains one — and
/// `schtasks`' own "Next Run Time" column does, in locales that format dates
/// as `July 31, 2026 12:00:00 AM`.
fn parse_csv_fields(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();

    while let Some(ch) = chars.next() {
        match ch {
            '"' if in_quotes && chars.peek() == Some(&'"') => {
                current.push('"');
                chars.next();
            }
            '"' => in_quotes = !in_quotes,
            ',' if !in_quotes => fields.push(core::mem::take(&mut current)),
            other => current.push(other),
        }
    }
    fields.push(current);
    fields
}

/// Reads the `Status` column — always the last one — out of `schtasks`'
/// `/FO CSV /NH` output.
fn parse_schtasks_csv(output: &str) -> ServiceState {
    let running = output
        .lines()
        .next()
        .map(parse_csv_fields)
        .and_then(|fields| fields.last().cloned())
        .is_some_and(|status| status.eq_ignore_ascii_case("Running"));
    if running {
        ServiceState::Running
    } else {
        ServiceState::Stopped
    }
}

// ---------------------------------------------------------------------------
// The kind-dispatching operations `bookmarks-but-better service` calls.
// ---------------------------------------------------------------------------

/// Tells the service manager a new or changed definition exists.
///
/// # Errors
///
/// [`ServiceError::Tool`] when the service manager refuses.
pub fn reload(layout: &ServiceLayout, kind: ServiceKind) -> Result<(), ServiceError> {
    match kind {
        ServiceKind::Systemd => systemctl(&["daemon-reload"]).map(|_| ()),
        // XdgAutostart: nothing to reload — the session reads the entry at
        // the next login. LaunchAgent: deliberately not a bootstrap either —
        // every generated agent sets `RunAtLoad`, so loading one here would
        // start it even when the caller asked for `--no-start`.
        // `start`/`enable_and_start` are the only operations that load it,
        // and they always read the file at `layout`'s current path, so there
        // is nothing to register early.
        ServiceKind::XdgAutostart | ServiceKind::LaunchAgent => Ok(()),
        ServiceKind::ScheduledTask => schtasks_create(&layout.definition_path(kind)),
    }
}

/// Enables the service at login and (re)starts it now, so that what runs is
/// the definition just installed.
///
/// A restart rather than a start: `service install` is how a new binary, a new
/// port or a changed set of vaults is applied, and every one of those is a
/// change the already-running process cannot pick up. A service that was not
/// running is simply started.
///
/// # Errors
///
/// [`ServiceError::Tool`] when the service manager refuses, and
/// [`ServiceError::Unwired`] for [`ServiceKind::XdgAutostart`].
pub fn enable_and_start(layout: &ServiceLayout, kind: ServiceKind) -> Result<(), ServiceError> {
    match kind {
        // `enable --now` would leave a running unit on its old command line;
        // `restart` starts a stopped unit and replaces a running one.
        ServiceKind::Systemd => {
            systemctl(&["enable", UNIT])?;
            systemctl(&["restart", UNIT]).map(|_| ())
        }
        // "Enabled at login" is already true the moment the plist sits in
        // `~/Library/LaunchAgents` — a real login session reloads everything
        // there on its own. Bootstrapping (after a bootout of whatever was
        // loaded) is the "run this definition now" half.
        ServiceKind::LaunchAgent => launchd_start(layout),
        // Likewise: the logon trigger already covers "enabled". A task that is
        // still running the old command line is ended first; ending one that
        // is not running is not an error worth stopping for.
        ServiceKind::ScheduledTask => {
            let _ = schtasks_end();
            schtasks_run()
        }
        ServiceKind::XdgAutostart => Err(xdg_autostart_unwired()),
    }
}

/// Starts the service.
///
/// # Errors
///
/// As [`enable_and_start`].
pub fn start(layout: &ServiceLayout, kind: ServiceKind) -> Result<(), ServiceError> {
    match kind {
        ServiceKind::Systemd => systemctl(&["start", UNIT]).map(|_| ()),
        ServiceKind::LaunchAgent => launchd_start(layout),
        ServiceKind::ScheduledTask => schtasks_run(),
        ServiceKind::XdgAutostart => Err(xdg_autostart_unwired()),
    }
}

/// Stops the service.
///
/// # Errors
///
/// As [`enable_and_start`].
pub fn stop(layout: &ServiceLayout, kind: ServiceKind) -> Result<(), ServiceError> {
    match kind {
        ServiceKind::Systemd => systemctl(&["stop", UNIT]).map(|_| ()),
        ServiceKind::LaunchAgent => launchd_stop(layout),
        ServiceKind::ScheduledTask => schtasks_end(),
        ServiceKind::XdgAutostart => Err(xdg_autostart_unwired()),
    }
}

/// Stops the service and stops it starting at login.
///
/// Failure is *not* an error here: `uninstall` calls this before removing the
/// definition, and a service that was already stopped, already disabled, or
/// never loaded must not prevent its own removal. Every branch is therefore
/// best-effort — this only ever drives the service manager, and **never**
/// touches the vault the service was pointed at.
pub fn disable_and_stop(layout: &ServiceLayout, kind: ServiceKind) {
    match kind {
        ServiceKind::Systemd => {
            let _ = systemctl(&["disable", "--now", UNIT]);
        }
        ServiceKind::LaunchAgent => {
            let _ = launchd_stop(layout);
        }
        ServiceKind::ScheduledTask => {
            let _ = schtasks_end();
            let _ = schtasks_delete();
        }
        ServiceKind::XdgAutostart => {}
    }
}

/// Unloads and removes the definition a version before 4.2.0 wrote, once the
/// current one has been written in its place. Returns the path it removed, if
/// there was one.
///
/// Both definitions start the same daemon on the same port, so the old agent
/// is booted out even under `--no-start`: left loaded, it would hold the port
/// the new one needs. Booted out *by its file*, never by its label, so that
/// nothing is unloaded unless its definition is in `layout`. If the file then
/// cannot be removed, the old agent is loaded again rather than leaving the
/// machine with no daemon at all.
///
/// # Errors
///
/// [`ServiceError::Io`] when the old file exists but cannot be removed.
pub fn retire_legacy(
    layout: &ServiceLayout,
    kind: ServiceKind,
) -> Result<Option<PathBuf>, ServiceError> {
    // Only the macOS agent ever had a legacy name, so the path is a plist.
    let Some(path) = layout.installed_legacy_definition_path(kind) else {
        return Ok(None);
    };
    let _ = launchd_bootout(&path);
    match super::remove_definition(path.clone()) {
        Ok(removed) => Ok(removed.then_some(path)),
        Err(error) => {
            let _ = launchd_bootstrap(&path);
            Err(error)
        }
    }
}

/// Reports what the service manager knows about the installed service.
///
/// # Errors
///
/// [`ServiceError::Tool`] when the service manager could not be asked at all.
/// A kind that is installed but unsupervised is [`ServiceState::InstalledUnsupervised`],
/// which is a state rather than an error: the entry really is installed, and
/// there is really nothing to ask about it.
pub fn state(layout: &ServiceLayout, kind: ServiceKind) -> Result<ServiceState, ServiceError> {
    if !is_installed(layout, kind) {
        return Ok(ServiceState::NotInstalled);
    }
    match kind {
        ServiceKind::Systemd => {
            // `is-active` exits non-zero for an inactive unit, which is an
            // answer rather than a failure, so the exit status is ignored and
            // the word it printed is read instead.
            let active = Command::new("systemctl")
                .args(["--user", "is-active", UNIT])
                .output()
                .map_err(|error| ServiceError::Tool {
                    command: format!("systemctl --user is-active {UNIT}"),
                    output: error.to_string(),
                })?;
            let answer = String::from_utf8_lossy(&active.stdout).trim().to_owned();
            Ok(if answer == "active" {
                ServiceState::Running
            } else {
                ServiceState::Stopped
            })
        }
        ServiceKind::XdgAutostart => Ok(ServiceState::InstalledUnsupervised),
        ServiceKind::LaunchAgent => launchd_installed_state(layout),
        ServiceKind::ScheduledTask => schtasks_state(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_autostart_entry_is_the_one_kind_that_stays_unwired() {
        for result in [
            start(&layout(), ServiceKind::XdgAutostart),
            stop(&layout(), ServiceKind::XdgAutostart),
            enable_and_start(&layout(), ServiceKind::XdgAutostart),
        ] {
            let error = result.expect_err("an unwired kind must not report success");
            assert!(matches!(error, ServiceError::Unwired { .. }), "{error}");
            assert!(!error.to_string().is_empty());
        }
    }

    /// A layout for tests that never touch the filesystem through it: every
    /// operation exercised against `XdgAutostart` and `reload(LaunchAgent, …)`
    /// returns without reading `layout` at all, so the path need not exist.
    fn layout() -> ServiceLayout {
        ServiceLayout::rooted_at("/nonexistent-test-home")
    }

    #[test]
    fn every_other_kind_no_longer_claims_to_be_unwired() {
        for kind in [
            ServiceKind::Systemd,
            ServiceKind::LaunchAgent,
            ServiceKind::ScheduledTask,
        ] {
            assert!(kind.is_wired(), "{kind:?}");
        }
        assert!(!ServiceKind::XdgAutostart.is_wired());
    }

    #[test]
    fn an_autostart_entry_reloads_trivially_but_cannot_be_started() {
        // There is nothing to reload, and nothing to start until next login;
        // saying so is different from failing.
        reload(&layout(), ServiceKind::XdgAutostart).expect("nothing to reload");
        let error = start(&layout(), ServiceKind::XdgAutostart).expect_err("cannot be started");
        assert!(error.to_string().contains("login"), "{error}");
    }

    #[test]
    fn an_uninstalled_service_reports_not_installed_without_consulting_any_tool() {
        let home = tempfile::tempdir().expect("temp dir");
        let layout = ServiceLayout::rooted_at(home.path());

        for kind in [
            ServiceKind::Systemd,
            ServiceKind::XdgAutostart,
            ServiceKind::LaunchAgent,
            ServiceKind::ScheduledTask,
        ] {
            assert_eq!(
                state(&layout, kind).expect("not installed is an answer"),
                ServiceState::NotInstalled,
                "{kind:?}"
            );
        }
    }

    #[test]
    fn an_installed_autostart_entry_is_reported_as_unsupervised() {
        let home = tempfile::tempdir().expect("temp dir");
        let layout = ServiceLayout::rooted_at(home.path());
        let spec = super::super::ServiceSpec::unchecked(
            "/usr/local/bin/bookmarks-but-better",
            "/home/user/Vault",
        );
        super::super::install(&layout, ServiceKind::XdgAutostart, &spec).expect("install");

        assert_eq!(
            state(&layout, ServiceKind::XdgAutostart).expect("state"),
            ServiceState::InstalledUnsupervised,
            "an autostart entry is installed, but nothing supervises it"
        );
    }

    #[test]
    fn disabling_never_fails_so_it_cannot_block_an_uninstall() {
        // Nothing is installed and there may be no systemd, launchctl or
        // schtasks at all; this must still return without panicking.
        let layout = layout();
        disable_and_stop(&layout, ServiceKind::Systemd);
        disable_and_stop(&layout, ServiceKind::LaunchAgent);
        disable_and_stop(&layout, ServiceKind::ScheduledTask);
        disable_and_stop(&layout, ServiceKind::XdgAutostart);
    }

    #[test]
    fn every_agent_definition_on_disk_is_found_with_its_label() {
        let home = tempfile::tempdir().expect("temp dir");
        let layout = ServiceLayout::rooted_at(home.path());
        let kind = ServiceKind::LaunchAgent;
        assert!(launchd_definitions(&layout).is_empty());

        let current = layout.definition_path(kind);
        let legacy = layout
            .legacy_definition_path(kind)
            .expect("the agent had a legacy name");
        std::fs::create_dir_all(current.parent().expect("parent")).expect("create");

        std::fs::write(&legacy, "old").expect("write");
        assert_eq!(
            launchd_definitions(&layout),
            vec![(legacy.clone(), crate::service::launchd::LEGACY_LABEL)]
        );

        // Both on disk — a failed retirement, or an older binary reinstalling —
        // and both are addressed, so neither can be left loaded unseen.
        std::fs::write(&current, "current").expect("write");
        assert_eq!(
            launchd_definitions(&layout),
            vec![
                (current, crate::service::SERVICE_LABEL),
                (legacy, crate::service::launchd::LEGACY_LABEL),
            ]
        );
    }

    #[test]
    fn retiring_removes_only_the_agent_an_earlier_version_wrote() {
        let home = tempfile::tempdir().expect("temp dir");
        let layout = ServiceLayout::rooted_at(home.path());
        let kind = ServiceKind::LaunchAgent;

        assert_eq!(
            retire_legacy(&layout, kind).expect("nothing to retire"),
            None
        );

        let legacy = layout
            .legacy_definition_path(kind)
            .expect("the agent had a legacy name");
        std::fs::create_dir_all(legacy.parent().expect("parent")).expect("create");
        // A label nothing loads: retiring boots the agent out by this file,
        // and the real legacy label may belong to a daemon running on the
        // machine these tests run on.
        std::fs::write(
            &legacy,
            "<plist><dict><key>Label</key><string>dev.but-better.bookmarks.test-legacy</string></dict></plist>",
        )
        .expect("write");
        let current = layout.definition_path(kind);
        std::fs::write(&current, "current").expect("write");

        assert_eq!(
            retire_legacy(&layout, kind).expect("retire"),
            Some(legacy.clone())
        );
        assert!(!legacy.exists());
        assert!(current.is_file(), "the current definition stays");

        for other in [
            ServiceKind::Systemd,
            ServiceKind::XdgAutostart,
            ServiceKind::ScheduledTask,
        ] {
            assert_eq!(
                retire_legacy(&layout, other).expect("no legacy name"),
                None,
                "{other:?}"
            );
        }
    }

    #[test]
    fn reload_never_starts_a_launch_agent() {
        // A `RunAtLoad` agent cannot be bootstrapped without also running, so
        // `reload` (which `--no-start` still calls) must not bootstrap one —
        // it has to do nothing and let `start`/`enable_and_start` be the only
        // path that ever loads it. This holds regardless of whether
        // `launchctl` itself is present, since `reload` never invokes it.
        reload(&layout(), ServiceKind::LaunchAgent).expect("reload never touches launchctl");
    }

    mod launchctl_output_parsing {
        use super::super::parse_launchctl_print;
        use super::*;

        #[test]
        fn a_running_service_is_reported_as_running() {
            let output =
                "gui/501/dev.but-better.bookmarks = {\n\tactive count = 1\n\tstate = running\n}\n";
            assert_eq!(parse_launchctl_print(output), ServiceState::Running);
        }

        #[test]
        fn a_waiting_or_exited_service_is_reported_as_stopped() {
            for state_line in [
                "state = waiting",
                "state = not running",
                "state = spawn scheduled",
            ] {
                let output = format!("gui/501/dev.but-better.bookmarks = {{\n\t{state_line}\n}}\n");
                assert_eq!(
                    parse_launchctl_print(&output),
                    ServiceState::Stopped,
                    "{output}"
                );
            }
        }

        #[test]
        fn output_with_no_state_line_is_reported_as_stopped() {
            assert_eq!(
                parse_launchctl_print("some unrelated output"),
                ServiceState::Stopped
            );
        }
    }

    mod schtasks_csv_parsing {
        use super::super::{parse_csv_fields, parse_schtasks_csv};
        use super::*;

        #[test]
        fn a_simple_line_splits_on_every_comma() {
            assert_eq!(
                parse_csv_fields(r#""BookmarksButBetter","1/1/2027 3:00:00 AM","Ready""#),
                vec![
                    r"BookmarksButBetter".to_owned(),
                    "1/1/2027 3:00:00 AM".to_owned(),
                    "Ready".to_owned(),
                ]
            );
        }

        #[test]
        fn a_comma_inside_a_quoted_field_does_not_split_it() {
            // The locale-dependent date format `schtasks` itself can produce.
            assert_eq!(
                parse_csv_fields(
                    r#""bookmarks-but-better","January 1, 2027 3:00:00 AM","Running""#
                ),
                vec![
                    "bookmarks-but-better".to_owned(),
                    "January 1, 2027 3:00:00 AM".to_owned(),
                    "Running".to_owned(),
                ]
            );
        }

        #[test]
        fn an_escaped_quote_inside_a_field_is_kept_literal() {
            assert_eq!(
                parse_csv_fields(r#""say ""hi""","N/A","Ready""#),
                vec![
                    "say \"hi\"".to_owned(),
                    "N/A".to_owned(),
                    "Ready".to_owned()
                ]
            );
        }

        #[test]
        fn the_status_column_drives_running_versus_stopped() {
            assert_eq!(
                parse_schtasks_csv(r#""bookmarks-but-better","1/1/2027 3:00:00 AM","Running""#),
                ServiceState::Running
            );
            assert_eq!(
                parse_schtasks_csv(r#""bookmarks-but-better","1/1/2027 3:00:00 AM","Ready""#),
                ServiceState::Stopped
            );
            assert_eq!(
                parse_schtasks_csv(r#""bookmarks-but-better","N/A","Disabled""#),
                ServiceState::Stopped
            );
        }

        #[test]
        fn status_matching_is_case_insensitive() {
            assert_eq!(
                parse_schtasks_csv(r#""bookmarks-but-better","N/A","RUNNING""#),
                ServiceState::Running
            );
        }
    }

    /// These exercise the real `launchctl` binary and only mean anything on
    /// macOS, where the daemon actually installs a `LaunchAgent`. Gated so
    /// they neither run nor need to compile a launchd-shaped assumption on
    /// any other CI runner.
    ///
    /// Both of them address the product's own [`SERVICE_LABEL`], which is a
    /// *global* name in the user's launchd domain — the plist lives under a
    /// throwaway [`ServiceLayout`], but `bootstrap`, `bootout` and `print`
    /// all resolve to the one label. Two consequences are handled here rather
    /// than hoped away:
    ///
    /// - They cannot run concurrently with each other. One bootstraps the
    ///   label while the other asserts nothing is loaded under it, so
    ///   Playwright-style parallelism turns them into a coin flip.
    /// - They must not run at all on a machine where that agent is really
    ///   installed and loaded. `bootout` there stops the developer's own
    ///   daemon, and `launchd_state` reports *its* state instead of the
    ///   fixture's.
    ///
    /// [`SERVICE_LABEL`]: super::super::SERVICE_LABEL
    #[cfg(target_os = "macos")]
    mod launchd_integration {
        use std::sync::Mutex;

        use super::*;

        /// Serializes the two tests below against the one global label.
        static LABEL: Mutex<()> = Mutex::new(());

        /// Takes the label, tolerating a lock poisoned by an earlier panic:
        /// the guard exists to order these tests, not to protect data that a
        /// failed test could have left inconsistent.
        fn hold_the_label() -> std::sync::MutexGuard<'static, ()> {
            LABEL
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner)
        }

        /// Whether a real agent is already loaded under the product's label —
        /// a developer running their own daemon from `service install`.
        ///
        /// Checked while holding [`LABEL`], so the other test's fixture can
        /// never be mistaken for one. CI runners have no such install, which
        /// is where these tests are relied on.
        fn a_real_agent_is_loaded() -> bool {
            matches!(
                launchd_state(crate::service::SERVICE_LABEL),
                Ok(ServiceState::Running)
            )
        }

        fn spec(vault: &std::path::Path) -> crate::service::ServiceSpec {
            // `/usr/bin/true` is a real, harmless, always-present executable —
            // standing in for `bookmarks-but-better` so `launchctl` has something legitimate to
            // register. It ignores every argument `ServiceSpec` appends.
            crate::service::ServiceSpec::new("/usr/bin/true", vault).expect("absolute")
        }

        #[test]
        fn a_freshly_registered_agent_that_was_never_started_reports_stopped() {
            let _label = hold_the_label();
            if a_real_agent_is_loaded() {
                return;
            }
            let home = tempfile::tempdir().expect("temp dir");
            let layout = ServiceLayout::rooted_at(home.path());
            let vault = home.path().join("Vault");
            std::fs::create_dir_all(&vault).expect("vault dir");
            crate::service::install(&layout, ServiceKind::LaunchAgent, &spec(&vault))
                .expect("install");

            assert_eq!(
                state(&layout, ServiceKind::LaunchAgent).expect("state"),
                ServiceState::Stopped
            );
        }

        #[test]
        fn bootstrapping_then_booting_out_round_trips_without_error() {
            let _label = hold_the_label();
            if a_real_agent_is_loaded() {
                return;
            }
            let home = tempfile::tempdir().expect("temp dir");
            let layout = ServiceLayout::rooted_at(home.path());
            let vault = home.path().join("Vault");
            std::fs::create_dir_all(&vault).expect("vault dir");
            crate::service::install(&layout, ServiceKind::LaunchAgent, &spec(&vault))
                .expect("install");

            enable_and_start(&layout, ServiceKind::LaunchAgent).expect("bootstrap");
            // Idempotent: a second start reloads rather than erroring on
            // "already bootstrapped".
            start(&layout, ServiceKind::LaunchAgent).expect("bootstrap again");
            stop(&layout, ServiceKind::LaunchAgent).expect("bootout");

            assert_eq!(
                state(&layout, ServiceKind::LaunchAgent).expect("state"),
                ServiceState::Stopped,
                "booted out, so nothing is loaded"
            );

            // A repeat, and disable_and_stop on top of an already-unloaded
            // agent, must not panic or hang.
            disable_and_stop(&layout, ServiceKind::LaunchAgent);
        }
    }

    /// As above, but for the real `schtasks` binary on Windows.
    #[cfg(windows)]
    mod schtasks_integration {
        use super::*;

        fn spec(vault: &std::path::Path) -> crate::service::ServiceSpec {
            crate::service::ServiceSpec::unchecked(
                r"C:\Windows\System32\cmd.exe",
                &vault.to_string_lossy(),
            )
        }

        #[test]
        fn a_freshly_registered_task_that_was_never_run_reports_stopped() {
            let home = tempfile::tempdir().expect("temp dir");
            let layout = ServiceLayout::rooted_at(home.path());
            let vault = home.path().join("Vault");
            std::fs::create_dir_all(&vault).expect("vault dir");
            crate::service::install(&layout, ServiceKind::ScheduledTask, &spec(&vault))
                .expect("install");

            reload(&layout, ServiceKind::ScheduledTask).expect("register");
            assert_eq!(
                state(&layout, ServiceKind::ScheduledTask).expect("state"),
                ServiceState::Stopped
            );

            disable_and_stop(&layout, ServiceKind::ScheduledTask);
        }

        #[test]
        fn re_registering_the_same_task_is_idempotent() {
            let home = tempfile::tempdir().expect("temp dir");
            let layout = ServiceLayout::rooted_at(home.path());
            let vault = home.path().join("Vault");
            std::fs::create_dir_all(&vault).expect("vault dir");
            crate::service::install(&layout, ServiceKind::ScheduledTask, &spec(&vault))
                .expect("install");

            reload(&layout, ServiceKind::ScheduledTask).expect("register once");
            reload(&layout, ServiceKind::ScheduledTask).expect("register again, via /F");

            disable_and_stop(&layout, ServiceKind::ScheduledTask);
        }
    }
}
