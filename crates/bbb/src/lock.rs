//! The single-writer lock that keeps two daemons off one vault.
//!
//! Two daemons on one vault would each hold their own cached scan, and each
//! would decide independently that a revision was current. The optimistic
//! revision check cannot save them: both can read the same bytes, both can
//! pass, and the second rename wins silently. So the vault admits one writer.
//!
//! The lock is an advisory whole-file lock (`flock` on Unix, `LockFileEx` on
//! Windows, via [`std::fs::File::try_lock`]) on `<vault>/.bbb/lock`. Advisory
//! locking is the right tool because the operating system releases it when the
//! process exits — including when it is killed — so a crashed daemon never
//! leaves a vault that has to be unlocked by hand. The lock file's existence
//! means nothing; only the held lock does.
//!
//! `.bbb/` is a dot-directory, which the vault scanner already skips, so the
//! lock never appears as content.

use std::fs::{self, File, TryLockError};
use std::io;
use std::path::{Path, PathBuf};

/// The directory holding daemon-owned state inside a vault.
pub(crate) const STATE_DIRECTORY: &str = ".bbb";
/// The lock file's name inside [`STATE_DIRECTORY`].
pub(crate) const LOCK_FILE_NAME: &str = "lock";

/// An exclusive claim on one vault, released when dropped.
#[derive(Debug)]
pub struct VaultLock {
    file: File,
    path: PathBuf,
}

impl VaultLock {
    /// Takes the lock for `vault_root`, failing rather than waiting.
    ///
    /// # Errors
    ///
    /// Returns [`LockError::Held`] when another process already holds the
    /// vault, and [`LockError::Io`] when the state directory or lock file
    /// cannot be created.
    pub fn acquire(vault_root: &Path) -> Result<Self, LockError> {
        let directory = vault_root.join(STATE_DIRECTORY);
        fs::create_dir_all(&directory).map_err(|error| LockError::Io {
            path: directory.clone(),
            error,
        })?;

        let path = directory.join(LOCK_FILE_NAME);
        let file = File::options()
            .create(true)
            .read(true)
            .write(true)
            .truncate(false)
            .open(&path)
            .map_err(|error| LockError::Io {
                path: path.clone(),
                error,
            })?;

        match file.try_lock() {
            Ok(()) => Ok(Self { file, path }),
            Err(TryLockError::WouldBlock) => Err(LockError::Held { path }),
            Err(TryLockError::Error(error)) => Err(LockError::Io { path, error }),
        }
    }

    /// The path of the lock file, for error messages.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for VaultLock {
    fn drop(&mut self) {
        // Closing the file releases the lock on every supported platform; the
        // explicit unlock makes the intent visible and is harmless if it fails.
        let _ = self.file.unlock();
    }
}

/// Why a vault could not be claimed.
#[derive(Debug)]
#[non_exhaustive]
pub enum LockError {
    /// Another process holds the vault.
    Held {
        /// The lock file that is held.
        path: PathBuf,
    },
    /// The lock file itself could not be created or opened.
    Io {
        /// The path that failed.
        path: PathBuf,
        /// The underlying error.
        error: io::Error,
    },
}

impl core::fmt::Display for LockError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Held { path } => write!(
                f,
                "another bbb daemon already holds this vault (lock: {})",
                path.display()
            ),
            Self::Io { path, error } => write!(
                f,
                "the vault lock {} could not be taken: {error}",
                path.display()
            ),
        }
    }
}

impl core::error::Error for LockError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Self::Held { .. } => None,
            Self::Io { error, .. } => Some(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_second_acquire_is_refused_while_the_first_is_held() {
        let dir = tempfile::tempdir().expect("temp dir");
        let first = VaultLock::acquire(dir.path()).expect("first lock");
        let second = VaultLock::acquire(dir.path());
        assert!(matches!(second, Err(LockError::Held { .. })));
        drop(first);
        VaultLock::acquire(dir.path()).expect("lock is free again");
    }
}
