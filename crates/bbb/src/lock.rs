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
//! Both `.bbb` and the lock file inside it are opened through the vault's own
//! directory handle with no-follow. A `.bbb` that is a symbolic link or a
//! Windows reparse point is refused outright rather than followed: it would
//! otherwise let anyone who can write into the vault redirect the daemon's
//! state — and its lock — to a directory of their choosing, which is both a
//! write primitive and a way to make two daemons believe they each hold the
//! vault alone.
//!
//! `.bbb` is a dot-directory, which the vault scanner already skips, so none of
//! this appears as content.

use std::fs::TryLockError;
use std::io;
use std::path::{Path, PathBuf};

use cap_std::fs::Dir;

use crate::fsx;

/// The directory holding daemon-owned state inside a vault.
pub(crate) const STATE_DIRECTORY: &str = ".bbb";
/// The lock file's name inside [`STATE_DIRECTORY`].
pub(crate) const LOCK_FILE_NAME: &str = "lock";

/// An exclusive claim on one vault, released when dropped.
#[derive(Debug)]
pub struct VaultLock {
    file: std::fs::File,
    path: PathBuf,
}

impl VaultLock {
    /// Takes the lock for the vault behind `root`, failing rather than waiting.
    ///
    /// Returns the lock and a handle to the state directory, so the caller does
    /// not have to resolve `.bbb` a second time by name.
    ///
    /// # Errors
    ///
    /// Returns [`LockError::Held`] when another process already holds the
    /// vault, and [`LockError::Io`] when the state directory or lock file
    /// cannot be created — including when `.bbb` exists but is not a real
    /// directory.
    pub(crate) fn acquire(root: &Dir, display_root: &Path) -> Result<(Self, Dir), LockError> {
        let path = display_root.join(STATE_DIRECTORY).join(LOCK_FILE_NAME);

        let state =
            fsx::open_or_create_dir(root, STATE_DIRECTORY).map_err(|error| LockError::Io {
                path: display_root.join(STATE_DIRECTORY),
                error,
            })?;

        let file = state
            .open_with(LOCK_FILE_NAME, &fsx::lock_file_options())
            .map_err(|error| LockError::Io {
                path: path.clone(),
                error,
            })?
            .into_std();

        match file.try_lock() {
            Ok(()) => Ok((Self { file, path }, state)),
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
        let directory = tempfile::tempdir().expect("temp dir");
        let root = fsx::open_root(directory.path()).expect("open root");

        let (first, _state) = VaultLock::acquire(&root, directory.path()).expect("first lock");
        let second = VaultLock::acquire(&root, directory.path());
        assert!(matches!(second, Err(LockError::Held { .. })));

        drop(first);
        VaultLock::acquire(&root, directory.path()).expect("the lock is free again");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_state_directory_is_refused() {
        let outer = tempfile::tempdir().expect("temp dir");
        let vault = outer.path().join("vault");
        std::fs::create_dir(&vault).expect("create vault");
        let elsewhere = outer.path().join("elsewhere");
        std::fs::create_dir(&elsewhere).expect("create elsewhere");
        std::os::unix::fs::symlink(&elsewhere, vault.join(STATE_DIRECTORY)).expect("symlink");

        let root = fsx::open_root(&vault).expect("open root");
        let error = VaultLock::acquire(&root, &vault).expect_err("a symlinked .bbb is refused");

        assert!(matches!(error, LockError::Io { .. }), "{error}");
        assert!(
            !elsewhere.join(LOCK_FILE_NAME).exists(),
            "nothing may be written through the link"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_lock_file_is_refused() {
        let outer = tempfile::tempdir().expect("temp dir");
        let vault = outer.path().join("vault");
        std::fs::create_dir(&vault).expect("create vault");
        std::fs::create_dir(vault.join(STATE_DIRECTORY)).expect("create state");
        let target = outer.path().join("target");
        std::fs::write(&target, b"untouched").expect("write target");
        std::os::unix::fs::symlink(&target, vault.join(STATE_DIRECTORY).join(LOCK_FILE_NAME))
            .expect("symlink");

        let root = fsx::open_root(&vault).expect("open root");
        let error = VaultLock::acquire(&root, &vault).expect_err("a symlinked lock is refused");

        assert!(matches!(error, LockError::Io { .. }), "{error}");
        assert_eq!(
            std::fs::read(&target).expect("read target"),
            b"untouched",
            "the link target must not be opened for writing"
        );
    }
}
