//! Giving a directory the identity that makes it a vault.
//!
//! Initialisation writes exactly two files, both in the directory the user
//! named: `.bookmarks-but-better-folder.md`, which gives it an identity, and `.bookmarks-but-better-state.json`,
//! which records the order its children are already being shown in. It never
//! descends, so pointing `bookmarks-but-better init` at the wrong directory costs two files that
//! are trivial to delete, not a rewrite of a subtree.
//!
//! Sub-directories therefore start out without an identity of their own. That is
//! deliberate: they are shown read-only with a `missing_folder_metadata`
//! diagnostic until something explicitly gives them one, and the bookmarks
//! inside them stay visible and editable throughout.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use bookmarks_but_better_vault_core::{
    FOLDER_FILE_NAME, FolderState, Id, STATE_FILE_NAME, StateChild, VaultScan, render_folder, scan,
};

use cap_std::fs::Dir;

use crate::fsx;

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
/// root — and [`InitError::Occupied`] when a `.bookmarks-but-better-folder.md` is present but
/// unusable, because overwriting it would destroy an identity the daemon cannot
/// read but a future version might.
pub fn initialize(root: &Path) -> Result<InitOutcome, InitError> {
    match fs::symlink_metadata(root) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(InitError::Unreadable {
                path: root.to_path_buf(),
                error: io::Error::new(
                    io::ErrorKind::InvalidInput,
                    "the vault root is not a real directory",
                ),
            });
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            fs::create_dir(root).map_err(|error| InitError::Unreadable {
                path: root.to_path_buf(),
                error,
            })?;
        }
        Err(error) => {
            return Err(InitError::Unreadable {
                path: root.to_path_buf(),
                error,
            });
        }
    }

    let scan = scan(root).map_err(|error| InitError::Unreadable {
        path: root.to_path_buf(),
        error,
    })?;

    // The root is opened once, no-follow, and every file is resolved against
    // that handle. A `.bookmarks-but-better-folder.md` that is a symbolic link is refused rather
    // than written through, so initialising a directory can never write outside
    // it.
    let handle = fsx::open_root(root).map_err(|error| InitError::Unreadable {
        path: root.to_path_buf(),
        error,
    })?;

    if let Some(id) = scan.folder().id() {
        // Already a vault. It may still predate the child order file, or have
        // lost it; writing the one it should have is a repair, and pins the
        // order it is being shown in right now rather than changing it.
        write_state(&handle, &scan)?;
        return Ok(InitOutcome::AlreadyInitialized { id });
    }

    let metadata = root.join(FOLDER_FILE_NAME);
    if handle.symlink_metadata(FOLDER_FILE_NAME).is_ok() {
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
    fsx::create_new(&handle, FOLDER_FILE_NAME, document.as_bytes()).map_err(|error| {
        // `AlreadyExists` here means something claimed the name between the
        // check above and this create; refusing is the same answer either way.
        if error.kind() == io::ErrorKind::AlreadyExists {
            InitError::Occupied { path: metadata }
        } else {
            InitError::Unreadable {
                path: metadata,
                error,
            }
        }
    })?;

    // The identity and the child order are one step as far as a caller is
    // concerned, so a directory that gains one and not the other is not left
    // behind: the metadata file goes back out again and the directory is
    // exactly as it was found.
    if let Err(error) = write_state(&handle, &scan) {
        let _ = fsx::remove_file(&handle, FOLDER_FILE_NAME);
        return Err(error);
    }

    Ok(InitOutcome::Created { id })
}

/// Writes the root's child order file, if it does not already have one.
///
/// The order recorded is the one the scan just resolved, which for a directory
/// with no state file is the migration order — so initialising pins what the
/// user is already looking at instead of rearranging it.
fn write_state(handle: &Dir, scan: &VaultScan) -> Result<(), InitError> {
    if scan.folder().state_revision().is_some() {
        return Ok(());
    }
    if handle.symlink_metadata(STATE_FILE_NAME).is_ok() {
        // Something is already at the name and the scan could not use it — a
        // link, or bytes this build does not understand. It is left alone.
        return Ok(());
    }

    let children: Vec<StateChild> = scan
        .folder()
        .children()
        .iter()
        .filter_map(|child| child.id().map(|id| (id, child.kind())))
        .map(|(id, kind)| StateChild::new(id, kind, crate::clock::now_rfc3339()))
        .collect();

    fsx::create_new(
        handle,
        STATE_FILE_NAME,
        &FolderState::new(children).render(),
    )
    .map_err(|error| InitError::Unreadable {
        path: PathBuf::from(STATE_FILE_NAME),
        error,
    })
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
    /// A `.bookmarks-but-better-folder.md` exists but does not yield a usable identity.
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
    use std::fs;

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
        fs::write(&metadata, b"---\nbookmarks_but_better_id: not-an-id\n---\n").expect("write");

        let error = initialize(dir.path()).expect_err("init must refuse");
        assert!(matches!(error, InitError::Occupied { .. }));
        assert_eq!(
            fs::read(&metadata).expect("metadata"),
            b"---\nbookmarks_but_better_id: not-an-id\n---\n"
        );
    }

    #[test]
    fn initialization_writes_the_root_child_order_too() {
        let dir = tempfile::tempdir().expect("temp dir");
        initialize(dir.path()).expect("init");
        assert_eq!(
            fs::read_to_string(dir.path().join(STATE_FILE_NAME)).expect("order file"),
            "{\n  \"version\": 1,\n  \"children\": []\n}\n"
        );
    }

    #[test]
    fn initialization_records_the_order_the_directory_is_already_shown_in() {
        let dir = tempfile::tempdir().expect("temp dir");
        // Two bookmarks a user already had, in a directory that is not a vault
        // yet. Init pins the migration order rather than rearranging anything.
        for (id, created) in [
            ("bbbbbbbb", "2026-02-01T00:00:00Z"),
            ("aaaaaaaa", "2026-01-01T00:00:00Z"),
        ] {
            fs::write(
                dir.path().join(format!("Note--{id}.md")),
                format!(
                    "---\nbookmarks_but_better_id: {id}\nbookmarks_but_better_url: https://x.example\nbookmarks_but_better_title: Note\n\
                     bookmarks_but_better_created: {created}\nbookmarks_but_better_updated: {created}\n---\n"
                ),
            )
            .expect("write");
        }

        initialize(dir.path()).expect("init");

        let written = fs::read_to_string(dir.path().join(STATE_FILE_NAME)).expect("order file");
        assert!(
            written.find("aaaaaaaa").expect("listed") < written.find("bbbbbbbb").expect("listed"),
            "the older bookmark is recorded first, as it was already displayed: {written}"
        );
    }

    #[test]
    fn a_second_init_writes_a_missing_order_file_without_touching_the_identity() {
        let dir = tempfile::tempdir().expect("temp dir");
        initialize(dir.path()).expect("init");
        let identity = fs::read(dir.path().join(FOLDER_FILE_NAME)).expect("metadata");
        fs::remove_file(dir.path().join(STATE_FILE_NAME)).expect("remove order");

        let second = initialize(dir.path()).expect("second init");

        assert!(!second.created(), "the vault was already initialized");
        assert!(
            dir.path().join(STATE_FILE_NAME).is_file(),
            "but a missing order file is repaired"
        );
        assert_eq!(
            fs::read(dir.path().join(FOLDER_FILE_NAME)).expect("metadata"),
            identity,
            "and the identity is not rewritten"
        );
    }

    #[cfg(unix)]
    #[test]
    fn an_order_file_that_is_a_link_is_left_exactly_as_found() {
        let outer = tempfile::tempdir().expect("temp dir");
        let root = outer.path().join("vault");
        fs::create_dir(&root).expect("create vault");
        let target = outer.path().join("outside.json");
        fs::write(&target, b"untouched").expect("write");
        std::os::unix::fs::symlink(&target, root.join(STATE_FILE_NAME)).expect("symlink");

        initialize(&root).expect("init");

        assert_eq!(
            fs::read(&target).expect("read"),
            b"untouched",
            "init must never write through a link"
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

    #[test]
    fn initialization_creates_the_requested_missing_directory_only() {
        let parent = tempfile::tempdir().expect("temp dir");
        let root = parent.path().join("Bookmarks");

        let outcome = initialize(&root).expect("init");

        assert!(outcome.created());
        assert!(root.is_dir());
        assert!(root.join(FOLDER_FILE_NAME).is_file());
    }

    #[test]
    fn initialization_does_not_create_missing_parent_directories() {
        let parent = tempfile::tempdir().expect("temp dir");
        let root = parent.path().join("missing").join("Bookmarks");

        let error = initialize(&root).expect_err("missing parent is refused");

        assert!(matches!(error, InitError::Unreadable { .. }));
        assert!(!parent.path().join("missing").exists());
    }
}
