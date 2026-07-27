//! How the API addresses a vault entry.
//!
//! Almost every entry is addressed by its stable [`Id`], the eight base-36
//! characters that live in the front matter and survive renames and moves.
//!
//! One kind of entry has no such identity: a directory with no usable
//! `.bbb-folder.md`, which is the normal state of a folder tree the user
//! created in a file manager. Hiding those directories would hide the bookmarks
//! inside them, so they are shown with a *synthetic* address built from their
//! vault-relative path and marked read-only.
//!
//! The two address spaces cannot collide, because a synthetic address starts
//! with `!` and [`Id`] only ever contains `0-9a-z`.

use core::fmt;

use bbb_vault_core::Id;
use serde::Serialize;

/// The prefix that marks a path-derived, non-identity address.
pub(crate) const SYNTHETIC_PREFIX: char = '!';

/// A reference to one entry in the vault, as it appears in a URL or a payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum EntryRef {
    /// A stable identity from front matter.
    Identity(Id),
    /// A directory that has no identity, addressed by its vault-relative path.
    ///
    /// These are read-only: without a `.bbb-folder.md` there is nothing that
    /// would survive the directory being renamed, so accepting a write would be
    /// promising a stability the vault cannot deliver.
    Path(String),
}

impl EntryRef {
    /// Parses the wire form.
    ///
    /// # Errors
    ///
    /// Returns [`EntryRefError`] when the text is neither a valid identity nor
    /// a non-empty synthetic address.
    pub fn parse(text: &str) -> Result<Self, EntryRefError> {
        if let Some(path) = text.strip_prefix(SYNTHETIC_PREFIX) {
            if path.is_empty() {
                return Err(EntryRefError);
            }
            return Ok(Self::Path(path.to_owned()));
        }
        Id::parse(text)
            .map(Self::Identity)
            .map_err(|_| EntryRefError)
    }

    /// The identity, when this reference has one.
    #[must_use]
    pub const fn identity(&self) -> Option<Id> {
        match self {
            Self::Identity(id) => Some(*id),
            Self::Path(_) => None,
        }
    }

    /// Builds the synthetic address of a directory at `relative_path`.
    #[must_use]
    pub(crate) fn synthetic(relative_path: &str) -> Self {
        Self::Path(relative_path.to_owned())
    }
}

impl fmt::Display for EntryRef {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Identity(id) => write!(f, "{id}"),
            Self::Path(path) => write!(f, "{SYNTHETIC_PREFIX}{path}"),
        }
    }
}

impl Serialize for EntryRef {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

/// The text is not a usable entry address.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EntryRefError;

impl fmt::Display for EntryRefError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(
            "an entry id is eight characters of `0-9a-z`, or `!` followed by a vault-relative path",
        )
    }
}

impl core::error::Error for EntryRefError {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_identity_round_trips() {
        let reference = EntryRef::parse("a1b2c3d4").expect("valid id");
        assert!(reference.identity().is_some());
        assert_eq!(reference.to_string(), "a1b2c3d4");
    }

    #[test]
    fn a_synthetic_address_round_trips_and_has_no_identity() {
        let reference = EntryRef::parse("!Archive/2024").expect("valid synthetic address");
        assert_eq!(reference, EntryRef::Path("Archive/2024".to_owned()));
        assert!(reference.identity().is_none());
        assert_eq!(reference.to_string(), "!Archive/2024");
    }

    #[test]
    fn malformed_addresses_are_refused() {
        for text in ["", "!", "too-long-to-be-an-id", "UPPER123", "abc"] {
            assert!(EntryRef::parse(text).is_err(), "{text} must be refused");
        }
    }
}
