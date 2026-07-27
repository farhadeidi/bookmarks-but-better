//! Content revisions used for optimistic concurrency control.

use core::fmt;

use crate::hash::sha256;

/// A stable content fingerprint of an on-disk vault file.
///
/// The revision is a SHA-256 digest of the exact file bytes. It depends on
/// nothing but those bytes, so it is identical on every platform, across
/// restarts and across copies of the vault. It exists to detect stale writes,
/// not to authenticate anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Revision([u8; 32]);

impl Revision {
    /// Computes the revision of a byte slice.
    #[must_use]
    pub fn of(bytes: &[u8]) -> Self {
        Self(sha256(bytes))
    }

    /// Returns the raw digest.
    #[must_use]
    pub const fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }

    /// Parses a revision from its lowercase hexadecimal representation.
    ///
    /// Returns `None` unless the input is exactly 64 lowercase hex digits.
    #[must_use]
    pub fn from_hex(text: &str) -> Option<Self> {
        if text.len() != 64 {
            return None;
        }
        let bytes = text.as_bytes();
        let mut digest = [0u8; 32];
        for (index, slot) in digest.iter_mut().enumerate() {
            let high = hex_value(bytes[index * 2])?;
            let low = hex_value(bytes[index * 2 + 1])?;
            *slot = (high << 4) | low;
        }
        Some(Self(digest))
    }
}

const fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        _ => None,
    }
}

impl fmt::Display for Revision {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for byte in self.0 {
            write!(f, "{byte:02x}")?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::Revision;

    #[test]
    fn revision_is_content_addressed() {
        assert_eq!(Revision::of(b"abc"), Revision::of(b"abc"));
        assert_ne!(Revision::of(b"abc"), Revision::of(b"abd"));
    }

    #[test]
    fn revision_round_trips_through_hex() {
        let revision = Revision::of(b"bookmarks");
        let text = revision.to_string();
        assert_eq!(text.len(), 64);
        assert_eq!(Revision::from_hex(&text), Some(revision));
    }

    #[test]
    fn revision_rejects_malformed_hex() {
        assert_eq!(Revision::from_hex(""), None);
        assert_eq!(Revision::from_hex(&"z".repeat(64)), None);
        assert_eq!(Revision::from_hex(&"A".repeat(64)), None);
    }
}
