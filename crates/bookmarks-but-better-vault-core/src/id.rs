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

/// The number of distinct identities: `36^8`, a little under 2^42.
const ID_SPACE: u64 = 2_821_109_907_456;

/// How many times [`Id::generate_unique`] retries before giving up.
///
/// A caller that hits this has either exhausted the identity space or supplied
/// a predicate that rejects everything; both are bugs worth surfacing rather
/// than looping forever.
pub const MAX_GENERATION_ATTEMPTS: usize = 64;

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

    /// Generates a fresh identity from operating-system randomness.
    ///
    /// Entropy comes from [`getrandom`], which reads the platform's own
    /// cryptographically secure generator (`getrandom(2)` on Linux,
    /// `getentropy` on the BSDs and macOS, `ProcessPrng` on Windows). Draws
    /// outside the largest whole multiple of the identity space are rejected and
    /// redrawn, so every identity is equally likely.
    ///
    /// This says nothing about *uniqueness*: with roughly 2^42 identities the
    /// birthday bound puts a first collision around two million entries. Use
    /// [`Id::generate_unique`] whenever the identities already in use are known,
    /// and treat the [`crate::DiagnosticCode::DuplicateId`] diagnostic as the
    /// backstop.
    ///
    /// # Errors
    ///
    /// Returns [`IdGenerationError::Entropy`] when the operating system refuses
    /// to supply randomness. Callers must not fall back to a weaker source: a
    /// vault with predictable identities is worse than a vault with none.
    pub fn generate() -> Result<Self, IdGenerationError> {
        // Only accept from the largest whole multiple of `ID_SPACE`, so the
        // modulo in `from_seed` stays uniform. The rejected tail is about one
        // draw in five million.
        let limit = (u64::MAX / ID_SPACE) * ID_SPACE;
        let mut buffer = [0u8; 8];
        loop {
            getrandom::fill(&mut buffer).map_err(IdGenerationError::Entropy)?;
            let drawn = u64::from_le_bytes(buffer);
            if drawn < limit {
                return Ok(Self::from_seed(drawn));
            }
        }
    }

    /// Generates a fresh identity that `is_taken` rejects, retrying on collision.
    ///
    /// # Errors
    ///
    /// Returns [`IdGenerationError::Entropy`] when the operating system refuses
    /// to supply randomness, and [`IdGenerationError::Exhausted`] when
    /// [`MAX_GENERATION_ATTEMPTS`] fresh identities were all rejected.
    pub fn generate_unique(
        mut is_taken: impl FnMut(Self) -> bool,
    ) -> Result<Self, IdGenerationError> {
        for _ in 0..MAX_GENERATION_ATTEMPTS {
            let candidate = Self::generate()?;
            if !is_taken(candidate) {
                return Ok(candidate);
            }
        }
        Err(IdGenerationError::Exhausted {
            attempts: MAX_GENERATION_ATTEMPTS,
        })
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

/// Why a fresh identity could not be produced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[non_exhaustive]
pub enum IdGenerationError {
    /// The operating system refused to supply randomness.
    Entropy(getrandom::Error),
    /// Every attempt collided with an identity already in use.
    Exhausted {
        /// How many identities were drawn and rejected.
        attempts: usize,
    },
}

impl fmt::Display for IdGenerationError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Entropy(error) => {
                write!(f, "the operating system supplied no randomness: {error}")
            }
            Self::Exhausted { attempts } => write!(
                f,
                "no free identity was found after {attempts} attempts; the vault may be corrupt"
            ),
        }
    }
}

impl Error for IdGenerationError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Entropy(error) => Some(error),
            Self::Exhausted { .. } => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{ID_LENGTH, Id, IdError, IdGenerationError, MAX_GENERATION_ATTEMPTS};
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
            let id = Id::generate().expect("the operating system has randomness");
            assert_eq!(id.as_str().len(), ID_LENGTH);
            assert_eq!(Id::parse(id.as_str()), Ok(id));
            seen.insert(id);
        }
        // A handful of collisions would still be tolerable, but anything close
        // to the birthday bound would mean the entropy source regressed.
        assert!(seen.len() > 9_990, "only {} distinct ids", seen.len());
    }

    #[test]
    fn generation_retries_past_identities_already_in_use() {
        let mut taken = HashSet::new();
        for _ in 0..200 {
            let id =
                Id::generate_unique(|candidate| taken.contains(&candidate)).expect("a free id");
            assert!(taken.insert(id), "generate_unique returned a used identity");
        }
    }

    #[test]
    fn generation_gives_up_rather_than_looping_forever() {
        let error = Id::generate_unique(|_| true).expect_err("every candidate was rejected");
        assert_eq!(
            error,
            IdGenerationError::Exhausted {
                attempts: MAX_GENERATION_ATTEMPTS
            }
        );
    }
}
