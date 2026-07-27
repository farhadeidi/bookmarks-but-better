//! Giving a directory the identity that makes it a vault.
//!
//! Initialisation writes exactly one file: `.bbb-folder.md` in the directory the
//! user named. It never descends, so pointing `bbb init` at the wrong directory
//! costs one file that is trivial to delete, not a rewrite of a subtree.
//!
//! Sub-directories therefore start out without an identity of their own. That is
//! deliberate: they are shown read-only with a `missing_folder_metadata`
//! diagnostic until something explicitly gives them one, and the bookmarks
//! inside them stay visible and editable throughout.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use bbb_vault_core::{FOLDER_FILE_NAME, Id, render_folder, scan};

use crate::atomic;

/// What [`initialize`] did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InitOutcome {
    /// The root metadata file was created.
    Created {
        /// The identity the vault now has.
        id: Id,
    },
    /// The directory was already a vault; nothing was written.
    AlreadyInitialized {
        /// The identity it already had.
        id: Id,
    },
}

impl InitOutcome {
    /// The vault's identity, however it was arrived at.
    #[must_use]
    pub const fn id(&self) -> Id {
        match self {
            Self::Created { id } | Self::AlreadyInitialized { id } => *id,
        }
    }

    /// Whether a file was written.
    #[must_use]
    pub const fn created(&self) -> bool {
        matches!(self, Self::Created { .. })
    }
}

/// Makes `root` a vault root, or reports that it already is one.
///
/// The title is deliberately left out of the written file so that the vault's
/// display name follows the directory name. A user who renames the directory
/// gets the rename reflected instead of a stale title.
///
/// # Errors
///
/// Returns [`InitError::Unreadable`] when the directory cannot be scanned —
/// including when it is a symbolic link, which is never accepted as a vault
/// root — and [`InitError::Occupied`] when a `.bbb-folder.md` is present but
/// unusable, because overwriting it would destroy an identity the daemon cannot
/// read but a future version might.
pub fn initialize(root: &Path) -> Result<InitOutcome, InitError> {
    let scan = scan(root).map_err(|error| InitError::Unreadable {
        path: root.to_path_buf(),
        error,
    })?;

    if let Some(id) = scan.folder().id() {
        return Ok(InitOutcome::AlreadyInitialized { id });
    }

    let metadata = root.join(FOLDER_FILE_NAME);
    if fs::symlink_metadata(&metadata).is_ok() {
        return Err(InitError::Occupied { path: metadata });
    }

    let id = Id::generate_unique(|candidate| {
        !scan.bookmarks_claiming(candidate).is_empty()
            || !scan.folders_claiming(candidate).is_empty()
    })
    .map_err(|error| InitError::Identity {
        detail: error.to_string(),
    })?;

    let document = render_folder(id, None).map_err(|error| InitError::Identity {
        detail: error.to_string(),
    })?;
    atomic::create_new(&metadata, document.as_bytes()).map_err(|error| InitError::Unreadable {
        path: metadata,
        error,
    })?;

    Ok(InitOutcome::Created { id })
}

/// Why a directory could not be made into a vault.
#[derive(Debug)]
#[non_exhaustive]
pub enum InitError {
    /// The directory could not be read, or is not a real directory.
    Unreadable {
        /// The path that failed.
        path: PathBuf,
        /// The underlying error.
        error: io::Error,
    },
    /// A `.bbb-folder.md` exists but does not yield a usable identity.
    Occupied {
        /// The file that is in the way.
        path: PathBuf,
    },
    /// No identity could be generated or rendered.
    Identity {
        /// The underlying explanation.
        detail: String,
    },
}

impl core::fmt::Display for InitError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Unreadable { path, error } => {
                write!(f, "{} could not be initialized: {error}", path.display())
            }
            Self::Occupied { path } => write!(
                f,
                "{} already exists but has no readable identity; fix or remove it before \
                 initializing",
                path.display()
            ),
            Self::Identity { detail } => {
                write!(f, "the vault identity could not be created: {detail}")
            }
        }
    }
}

impl core::error::Error for InitError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Self::Unreadable { error, .. } => Some(error),
            Self::Occupied { .. } | Self::Identity { .. } => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initializing_twice_writes_once() {
        let dir = tempfile::tempdir().expect("temp dir");
        let first = initialize(dir.path()).expect("first init");
        assert!(first.created());

        let bytes = fs::read(dir.path().join(FOLDER_FILE_NAME)).expect("metadata");
        let second = initialize(dir.path()).expect("second init");
        assert!(!second.created());
        assert_eq!(second.id(), first.id());
        assert_eq!(
            fs::read(dir.path().join(FOLDER_FILE_NAME)).expect("metadata"),
            bytes,
            "a second init must not rewrite the file"
        );
    }

    #[test]
    fn an_unreadable_metadata_file_is_never_overwritten() {
        let dir = tempfile::tempdir().expect("temp dir");
        let metadata = dir.path().join(FOLDER_FILE_NAME);
        fs::write(&metadata, b"---\nbbb_id: not-an-id\n---\n").expect("write");

        let error = initialize(dir.path()).expect_err("init must refuse");
        assert!(matches!(error, InitError::Occupied { .. }));
        assert_eq!(
            fs::read(&metadata).expect("metadata"),
            b"---\nbbb_id: not-an-id\n---\n"
        );
    }

    #[test]
    fn initialization_does_not_descend() {
        let dir = tempfile::tempdir().expect("temp dir");
        fs::create_dir(dir.path().join("Nested")).expect("create dir");
        initialize(dir.path()).expect("init");
        assert!(
            !dir.path().join("Nested").join(FOLDER_FILE_NAME).exists(),
            "init must write only the root metadata file"
        );
    }
}
