//! Stable, immutable vault identities.

use core::fmt;
use std::error::Error;

/// The alphabet an [`Id`] is drawn from.
///
/// Lowercase only, so that two identities can never collide on a
/// case-insensitive filesystem, and unpadded so the suffix stays short and
/// readable inside a filename.
pub const ID_ALPHABET: &str = "0123456789abcdefghijklmnopqrstuvwxyz";

/// The exact number of characters in an [`Id`].
pub const ID_LENGTH: usize = 8;

/// A stable identity for a bookmark or a folder.
///
/// The identity lives in front matter, never in the path, so it survives
/// renames, moves and title changes. The `--<id>` suffix embedded in a bookmark
/// filename is a convenience for humans and for recovery; front matter always
/// wins.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Id([u8; ID_LENGTH]);

impl Id {
    /// Parses an identity from text.
    ///
    /// # Errors
    ///
    /// Returns [`IdError`] unless `text` is exactly [`ID_LENGTH`] characters
    /// drawn from [`ID_ALPHABET`].
    pub fn parse(text: &str) -> Result<Self, IdError> {
        if text.len() != ID_LENGTH {
            return Err(IdError::Length {
                actual: text.chars().count(),
            });
        }
        let mut bytes = [0u8; ID_LENGTH];
        for (slot, character) in bytes.iter_mut().zip(text.chars()) {
            if !matches!(character, '0'..='9' | 'a'..='z') {
                return Err(IdError::Character { character });
            }
            *slot = u8::try_from(u32::from(character)).unwrap_or(b'?');
        }
        Ok(Self(bytes))
    }

    /// Returns the identity as text.
    ///
    /// # Panics
    ///
    /// Never: every construction path validates that the bytes are ASCII drawn
    /// from [`ID_ALPHABET`].
    #[must_use]
    pub fn as_str(&self) -> &str {
        core::str::from_utf8(&self.0).expect("an Id only ever holds ASCII bytes")
    }

    /// Generates a fresh identity.
    ///
    /// Entropy comes from [`std::collections::hash_map::RandomState`], which the
    /// standard library seeds from the operating system, mixed with the current
    /// time and a process-local counter so that identities generated in the same
    /// nanosecond still differ. This is a uniqueness source, not a security
    /// primitive: the vault enforces actual uniqueness by reporting duplicate
    /// identities as a diagnostic.
    #[must_use]
    pub fn generate() -> Self {
        use std::collections::hash_map::RandomState;
        use std::hash::{BuildHasher, Hasher};
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::{SystemTime, UNIX_EPOCH};

        static COUNTER: AtomicU64 = AtomicU64::new(0);

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .ok()
            .and_then(|elapsed| u64::try_from(elapsed.as_nanos() & u128::from(u64::MAX)).ok())
            .unwrap_or_default();

        let mut hasher = RandomState::new().build_hasher();
        hasher.write_u64(COUNTER.fetch_add(1, Ordering::Relaxed));
        hasher.write_u64(nanos);
        Self::from_seed(hasher.finish())
    }

    /// Derives an identity from a 64-bit seed.
    ///
    /// Exposed for tests and for callers that need reproducible identities; the
    /// mapping is a plain base-36 encoding of `seed % 36^8`.
    #[must_use]
    pub fn from_seed(seed: u64) -> Self {
        const RADIX: u64 = 36;
        let alphabet = ID_ALPHABET.as_bytes();
        let mut remaining = seed;
        let mut bytes = [b'0'; ID_LENGTH];
        for slot in bytes.iter_mut().rev() {
            *slot = alphabet[usize::try_from(remaining % RADIX).unwrap_or_default()];
            remaining /= RADIX;
        }
        Self(bytes)
    }
}

impl fmt::Display for Id {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// Why a piece of text is not a valid [`Id`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdError {
    /// The identity did not have exactly [`ID_LENGTH`] characters.
    Length {
        /// The number of characters that were supplied.
        actual: usize,
    },
    /// The identity contained a character outside [`ID_ALPHABET`].
    Character {
        /// The first offending character.
        character: char,
    },
}

impl fmt::Display for IdError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Length { actual } => {
                write!(f, "expected {ID_LENGTH} characters, found {actual}")
            }
            Self::Character { character } => write!(
                f,
                "unexpected character {character:?}, expected one of {ID_ALPHABET}"
            ),
        }
    }
}

impl Error for IdError {}

#[cfg(test)]
mod tests {
    use super::{ID_LENGTH, Id, IdError};
    use std::collections::HashSet;

    #[test]
    fn parses_valid_identities() {
        assert_eq!(Id::parse("a1b2c3d4").unwrap().as_str(), "a1b2c3d4");
        assert_eq!(Id::parse("00000000").unwrap().as_str(), "00000000");
        assert_eq!(Id::parse("zzzzzzzz").unwrap().as_str(), "zzzzzzzz");
    }

    #[test]
    fn rejects_wrong_length() {
        assert_eq!(Id::parse("abc"), Err(IdError::Length { actual: 3 }));
        assert_eq!(Id::parse("a1b2c3d4e"), Err(IdError::Length { actual: 9 }));
        assert_eq!(Id::parse(""), Err(IdError::Length { actual: 0 }));
    }

    #[test]
    fn rejects_uppercase_and_non_ascii() {
        assert_eq!(
            Id::parse("A1b2c3d4"),
            Err(IdError::Character { character: 'A' })
        );
        assert_eq!(
            Id::parse("a1b2c3d-"),
            Err(IdError::Character { character: '-' })
        );
        // Multi-byte input can pass the byte-length check, so it must still be
        // rejected on content.
        assert!(matches!(
            Id::parse("a1b2c3é"),
            Err(IdError::Character { .. })
        ));
    }

    #[test]
    fn seeds_encode_deterministically() {
        assert_eq!(Id::from_seed(0).as_str(), "00000000");
        assert_eq!(Id::from_seed(35).as_str(), "0000000z");
        assert_eq!(Id::from_seed(36).as_str(), "00000010");
    }

    #[test]
    fn generated_identities_are_well_formed_and_distinct() {
        let mut seen = HashSet::new();
        for _ in 0..10_000 {
            let id = Id::generate();
            assert_eq!(id.as_str().len(), ID_LENGTH);
            assert_eq!(Id::parse(id.as_str()), Ok(id));
            seen.insert(id);
        }
        // A handful of collisions would still be tolerable, but anything close
        // to the birthday bound would mean the entropy source regressed.
        assert!(seen.len() > 9_990, "only {} distinct ids", seen.len());
    }
}
