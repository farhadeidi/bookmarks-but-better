//! Driving the platform's service manager, for the platforms that are wired.
//!
//! Only systemd is. Every other kind's definition can be *written* — that half
//! is complete and tested — but nothing here will claim to have started it.
//! [`ServiceError::Unwired`] carries the exact command the user should run
//! instead, because "not implemented" without a way forward is not much better
//! than a lie.

use std::process::Command;

use super::{ServiceError, ServiceKind, ServiceLayout, ServiceState, is_installed};

/// The unit name `systemctl --user` is given.
const UNIT: &str = "bbb.service";

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

fn systemctl(arguments: &[&str]) -> Result<String, ServiceError> {
    let output = Command::new("systemctl")
        .arg("--user")
        .args(arguments)
        .output()
        .map_err(|error| ServiceError::Tool {
            command: format!("systemctl --user {}", arguments.join(" ")),
            output: error.to_string(),
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    if output.status.success() {
        return Ok(stdout);
    }

    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(ServiceError::Tool {
        command: format!("systemctl --user {}", arguments.join(" ")),
        output: if stderr.is_empty() { stdout } else { stderr },
    })
}

fn unwired(kind: ServiceKind) -> ServiceError {
    ServiceError::Unwired {
        kind,
        instead: match kind {
            ServiceKind::LaunchAgent => {
                "load it with `launchctl bootstrap gui/$UID <plist>` (and `bootout` to stop it)"
            }
            ServiceKind::ScheduledTask => {
                "register it with `schtasks /Create /XML <file> /TN \"Bookmarks But Better\\bbb\"`"
            }
            ServiceKind::XdgAutostart => {
                "an autostart entry starts at your next login; run `bbb serve` directly until then"
            }
            ServiceKind::Systemd => unreachable!("systemd is wired"),
        },
    }
}

/// Tells the service manager a new or changed definition exists.
///
/// # Errors
///
/// [`ServiceError::Tool`] when the service manager refuses, and
/// [`ServiceError::Unwired`] for a kind whose integration is not implemented.
pub fn reload(kind: ServiceKind) -> Result<(), ServiceError> {
    match kind {
        ServiceKind::Systemd => systemctl(&["daemon-reload"]).map(|_| ()),
        // Nothing to reload: the session reads the entry at the next login.
        ServiceKind::XdgAutostart => Ok(()),
        other => Err(unwired(other)),
    }
}

/// Enables the service at login and starts it now.
///
/// # Errors
///
/// As [`reload`].
pub fn enable_and_start(kind: ServiceKind) -> Result<(), ServiceError> {
    match kind {
        ServiceKind::Systemd => systemctl(&["enable", "--now", UNIT]).map(|_| ()),
        other => Err(unwired(other)),
    }
}

/// Starts the service.
///
/// # Errors
///
/// As [`reload`].
pub fn start(kind: ServiceKind) -> Result<(), ServiceError> {
    match kind {
        ServiceKind::Systemd => systemctl(&["start", UNIT]).map(|_| ()),
        other => Err(unwired(other)),
    }
}

/// Stops the service.
///
/// # Errors
///
/// As [`reload`].
pub fn stop(kind: ServiceKind) -> Result<(), ServiceError> {
    match kind {
        ServiceKind::Systemd => systemctl(&["stop", UNIT]).map(|_| ()),
        other => Err(unwired(other)),
    }
}

/// Stops the service and stops it starting at login.
///
/// Failure is *not* an error here: `uninstall` calls this before removing the
/// definition, and a service that was already stopped, already disabled, or
/// never loaded must not prevent its own removal.
pub fn disable_and_stop(kind: ServiceKind) {
    if kind == ServiceKind::Systemd {
        let _ = systemctl(&["disable", "--now", UNIT]);
    }
}

/// Reports what the service manager knows about the installed service.
///
/// # Errors
///
/// [`ServiceError::Unwired`] for a kind whose integration is not implemented.
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
        other => Err(unwired(other)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unwired_kind_refuses_rather_than_reporting_success() {
        for kind in [ServiceKind::LaunchAgent, ServiceKind::ScheduledTask] {
            for result in [
                start(kind),
                stop(kind),
                enable_and_start(kind),
                reload(kind),
            ] {
                let error = result.expect_err("an unwired kind must not report success");
                assert!(
                    matches!(error, ServiceError::Unwired { .. }),
                    "{kind:?}: {error}"
                );
                // The message has to leave the user somewhere to go.
                assert!(!error.to_string().is_empty());
            }
        }
    }

    #[test]
    fn an_unwired_error_names_the_command_to_run_by_hand() {
        let error = start(ServiceKind::LaunchAgent).expect_err("unwired");
        assert!(error.to_string().contains("launchctl"), "{error}");

        let error = start(ServiceKind::ScheduledTask).expect_err("unwired");
        assert!(error.to_string().contains("schtasks"), "{error}");
    }

    #[test]
    fn an_autostart_entry_reloads_trivially_but_cannot_be_started() {
        // There is nothing to reload, and nothing to start until next login;
        // saying so is different from failing.
        reload(ServiceKind::XdgAutostart).expect("nothing to reload");
        let error = start(ServiceKind::XdgAutostart).expect_err("cannot be started");
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
        let spec = super::super::ServiceSpec::new("/usr/local/bin/bbb", "/home/user/Vault")
            .expect("absolute");
        super::super::install(&layout, ServiceKind::XdgAutostart, &spec).expect("install");

        assert_eq!(
            state(&layout, ServiceKind::XdgAutostart).expect("state"),
            ServiceState::InstalledUnsupervised,
            "an autostart entry is installed, but nothing supervises it"
        );
    }

    #[test]
    fn disabling_never_fails_so_it_cannot_block_an_uninstall() {
        // Nothing is installed and there may be no systemd at all; this must
        // still return.
        disable_and_stop(ServiceKind::Systemd);
        disable_and_stop(ServiceKind::LaunchAgent);
    }
}
