//! Validation of a single path component.
//!
//! Everything this crate resolves against a directory handle must be one
//! component and nothing else. A handle-relative API looks like it enforces
//! that, and does not: `dir.open("a/b")` walks two levels, `dir.open("..")`
//! climbs out, and on Windows `dir.open("C:x")` is drive-relative. The sandbox
//! stops the *result* escaping; it does not stop the caller from meaning
//! something other than "the child called this".
//!
//! That matters most for names that did not come from this process. A staging
//! manifest is a file in the user's vault: it can be edited, it can be
//! corrupted, and after a crash it is the only thing telling recovery where to
//! put a file back. Trusting a string from it to be a plain name is trusting a
//! attacker-controlled path. So every component is validated at the boundary
//! *and* again inside each primitive, because the second check is the one that
//! still holds when a new call site is added later.
//!
//! # What is refused
//!
//! Traversal (`.`, `..`, separators, Windows drive prefixes), anything that
//! cannot be a filename (empty, over 255 bytes, NUL, control characters), and
//! anything that is not portable (Windows device names, trailing spaces and
//! dots, which Windows silently strips so that `foo.` and `foo` are one file).
//! `.bbb` is refused as well: it is the daemon's own state directory, and no
//! vault content may resolve into it.

use core::fmt;

/// The daemon's state directory, which vault content may never name.
pub(crate) const STATE_DIRECTORY: &str = ".bbb";

/// The longest a single component may be, in bytes.
///
/// 255 is the limit on every filesystem this runs on; a longer name could only
/// come from a corrupted record.
const MAX_COMPONENT_BYTES: usize = 255;

/// Why a string is not usable as a single path component.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ComponentError {
    /// The component is empty.
    Empty,
    /// The component is longer than a filesystem allows.
    TooLong,
    /// The component contains a path separator.
    Separator,
    /// The component is `.` or `..`.
    Traversal,
    /// The component names a drive or a root.
    Prefixed,
    /// The component contains a NUL or a control character.
    Control,
    /// The component would name a Windows device.
    ReservedDevice,
    /// The component ends in a space or a dot, which Windows strips.
    TrailingSpaceOrDot,
    /// The component is the daemon's own state directory.
    ReservedState,
}

impl ComponentError {
    /// A short explanation, for a diagnostic a user reads.
    pub(crate) const fn reason(self) -> &'static str {
        match self {
            Self::Empty => "it is empty",
            Self::TooLong => "it is longer than a filename may be",
            Self::Separator => "it contains a path separator",
            Self::Traversal => "it is `.` or `..`",
            Self::Prefixed => "it names a drive or a root",
            Self::Control => "it contains a NUL or a control character",
            Self::ReservedDevice => "it would name a Windows device",
            Self::TrailingSpaceOrDot => "it ends in a space or a dot",
            Self::ReservedState => "it names the daemon's own state directory",
        }
    }
}

impl fmt::Display for ComponentError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.reason())
    }
}

impl core::error::Error for ComponentError {}

/// Checks that `name` is one plain, portable path component.
///
/// # Errors
///
/// Returns the first rule `name` breaks.
pub(crate) fn check(name: &str) -> Result<(), ComponentError> {
    if name.is_empty() {
        return Err(ComponentError::Empty);
    }
    if name.len() > MAX_COMPONENT_BYTES {
        return Err(ComponentError::TooLong);
    }
    if name == "." || name == ".." {
        return Err(ComponentError::Traversal);
    }
    if name.contains('/') || name.contains('\\') {
        return Err(ComponentError::Separator);
    }
    // `C:x` is relative to the current directory *of that drive*, so a colon
    // anywhere makes the string something other than a plain name on Windows.
    if name.contains(':') {
        return Err(ComponentError::Prefixed);
    }
    if name
        .chars()
        .any(|character| character.is_control() || character == '\0')
    {
        return Err(ComponentError::Control);
    }
    if name.ends_with(' ') || name.ends_with('.') {
        return Err(ComponentError::TrailingSpaceOrDot);
    }
    if bbb_vault_core::is_reserved_stem(name) {
        return Err(ComponentError::ReservedDevice);
    }
    if name == STATE_DIRECTORY {
        return Err(ComponentError::ReservedState);
    }
    Ok(())
}

/// Checks every component of a vault-relative directory path.
///
/// An empty slice is the vault root and is valid.
///
/// # Errors
///
/// Returns the offending component and the rule it breaks.
pub(crate) fn check_all(components: &[String]) -> Result<(), (String, ComponentError)> {
    for component in components {
        check(component).map_err(|error| (component.clone(), error))?;
    }
    Ok(())
}

/// Splits a `/`-separated vault-relative path into validated components.
///
/// # Errors
///
/// Returns the offending component and the rule it breaks.
pub(crate) fn split(relative: &str) -> Result<Vec<String>, (String, ComponentError)> {
    let components: Vec<String> = relative
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect();
    check_all(&components)?;
    Ok(components)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ordinary_names_are_accepted() {
        for name in [
            "React--a1b2c3d4.md",
            ".bbb-folder.md",
            "React--a1b2c3d4.assets",
            "Dev",
            ".obsidian",
            "a name with spaces.md",
            "Ünïcøde—name.md",
        ] {
            check(name).unwrap_or_else(|error| panic!("{name} must be accepted: {error}"));
        }
    }

    #[test]
    fn traversal_is_refused() {
        assert_eq!(check("."), Err(ComponentError::Traversal));
        assert_eq!(check(".."), Err(ComponentError::Traversal));
        assert_eq!(check("a/b"), Err(ComponentError::Separator));
        assert_eq!(check("a\\b"), Err(ComponentError::Separator));
        assert_eq!(check("../etc/passwd"), Err(ComponentError::Separator));
        assert_eq!(check("/etc/passwd"), Err(ComponentError::Separator));
    }

    #[test]
    fn windows_shaped_paths_are_refused() {
        assert_eq!(check("C:"), Err(ComponentError::Prefixed));
        assert_eq!(check("C:x"), Err(ComponentError::Prefixed));
        assert_eq!(check(r"\\?\C:\x"), Err(ComponentError::Separator));
        assert_eq!(check("CON"), Err(ComponentError::ReservedDevice));
        assert_eq!(check("nul.txt"), Err(ComponentError::ReservedDevice));
        assert_eq!(check("name."), Err(ComponentError::TrailingSpaceOrDot));
        assert_eq!(check("name "), Err(ComponentError::TrailingSpaceOrDot));
    }

    #[test]
    fn unusable_names_are_refused() {
        assert_eq!(check(""), Err(ComponentError::Empty));
        assert_eq!(check("a\0b"), Err(ComponentError::Control));
        assert_eq!(check("a\nb"), Err(ComponentError::Control));
        assert_eq!(check("a\u{7f}b"), Err(ComponentError::Control));
        assert_eq!(check(&"x".repeat(256)), Err(ComponentError::TooLong));
    }

    #[test]
    fn the_state_directory_is_refused() {
        assert_eq!(check(".bbb"), Err(ComponentError::ReservedState));
        // Only by that exact name; a bookmark may still be called `.bbbb`.
        check(".bbbb").expect("a different name is fine");
    }

    #[test]
    fn a_path_splits_into_validated_components() {
        assert_eq!(split("").expect("root"), Vec::<String>::new());
        assert_eq!(
            split("Dev/Nested").expect("nested"),
            vec!["Dev".to_owned(), "Nested".to_owned()]
        );
        assert_eq!(
            split("Dev/../../etc").expect_err("traversal").1,
            ComponentError::Traversal
        );
        assert_eq!(
            split("Dev/.bbb").expect_err("state").1,
            ComponentError::ReservedState
        );
    }
}
