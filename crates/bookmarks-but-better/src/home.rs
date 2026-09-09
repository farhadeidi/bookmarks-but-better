//! Where this user's files live.
//!
//! Two questions — "which home directory" and "which config directory" — with
//! one answer each, shared by everything that writes outside a vault: the
//! service definitions ([`crate::service::ServiceLayout`]) and the Vault
//! Registry ([`crate::config::ConfigLocation`]). Two copies of this would be
//! two places for the daemon's own files to disagree about, on the one platform
//! (Windows, which has no `HOME`) where the answer is least obvious.
//!
//! Nothing here creates a directory or touches the filesystem; these are string
//! answers, and the callers that write decide what to create.

use std::path::PathBuf;

/// The user's home directory, when it is known and absolute.
///
/// Relative answers are discarded rather than resolved against the working
/// directory: a `HOME=.` would otherwise put a service definition wherever the
/// command happened to be run from.
#[must_use]
pub(crate) fn home_directory() -> Option<PathBuf> {
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

/// The user's config directory: `$XDG_CONFIG_HOME`, else `$HOME/.config`.
///
/// The XDG variable is honoured on every platform, not only Linux, because a
/// test and a container both set it to say "keep your files here" and both
/// deserve to be obeyed.
#[must_use]
pub(crate) fn config_home() -> Option<PathBuf> {
    if let Some(config_home) = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from)
        && config_home.is_absolute()
    {
        return Some(config_home);
    }
    home_directory().map(|home| home.join(".config"))
}
