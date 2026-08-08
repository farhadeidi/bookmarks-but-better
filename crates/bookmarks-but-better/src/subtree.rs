//! Proving that a folder is safe to delete before any of it is deleted.
//!
//! A recursive delete is the one operation that can destroy data the user never
//! told the daemon about. The single revision a client sends covers the
//! folder's own `.bookmarks-but-better-folder.md` and says nothing about the thousand files
//! underneath it, so accepting it as permission to erase a subtree is accepting
//! a permission the client was never in a position to give.
//!
//! So the subtree is verified immediately before it is staged, against the scan
//! taken inside the same request, and the delete proceeds only if:
//!
//! * every file in it is one the vault manages — a `.bookmarks-but-better-folder.md`, a scanned
//!   bookmark, or a file inside a scanned bookmark's `.assets` directory — and
//! * every one of those bookmarks, **every nested `.bookmarks-but-better-folder.md` and every
//!   nested `.bookmarks-but-better-state.json`** still has the exact bytes the scan saw. The
//!   nested machine-managed files matter as much as the bookmarks: they carry
//!   the identities of the folders about to be destroyed and the order of
//!   everything inside them, and one changing means the subtree was rearranged
//!   underneath the request.
//!
//! Anything else refuses. A stray `notes.txt`, an `.obsidian` directory, a
//! symbolic link, a bookmark an editor touched a moment ago: each of those is a
//! reason to stop, because each of them means the daemon is about to delete
//! something it cannot describe. There is no override flag. A user who really
//! wants the subtree gone can remove the unmanaged parts themselves, in a file
//! manager, where they can see what they are losing.

use std::collections::HashMap;
use std::io;

use bookmarks_but_better_vault_core::{
    FOLDER_FILE_NAME, FolderNode, Revision, STATE_FILE_NAME, assets_directory_name,
};
use cap_fs_ext::DirExt as _;
use cap_std::fs::Dir;

use crate::fsx;

/// What a verification found wrong.
#[derive(Debug)]
pub(crate) enum SubtreeRefusal {
    /// The subtree holds entries the vault does not manage.
    Unknown {
        /// Vault-relative paths, in traversal order, capped for the message.
        paths: Vec<String>,
        /// How many there are in total.
        total: usize,
    },
    /// A managed entry no longer matches the scan this request planned against.
    Changed {
        /// The vault-relative path that differs.
        path: String,
        /// Why it differs.
        reason: &'static str,
    },
    /// The subtree could not be read.
    Unreadable {
        /// The vault-relative path that failed.
        path: String,
        /// The underlying error kind.
        error: io::Error,
    },
}

/// How many offending paths an error message lists before summarising.
const LISTED_PATHS: usize = 3;

impl SubtreeRefusal {
    /// A message that names what is in the way and what to do about it.
    pub(crate) fn detail(&self) -> String {
        match self {
            Self::Unknown { paths, total } => {
                let listed = paths.join(", ");
                let rest = total.saturating_sub(paths.len());
                let more = if rest > 0 {
                    format!(", and {rest} more")
                } else {
                    String::new()
                };
                let noun = if *total == 1 { "entry" } else { "entries" };
                format!(
                    "the folder contains {total} {noun} this vault does not manage ({listed}\
                     {more}); remove them yourself before deleting the folder, so that nothing \
                     is destroyed that bookmarks-but-better cannot describe"
                )
            }
            Self::Changed { path, reason } => {
                format!("`{path}` {reason} since this request was planned; rescan and retry")
            }
            Self::Unreadable { path, error } => {
                format!("`{path}` could not be read: {}", error.kind())
            }
        }
    }
}

/// Everything the scan expects to find under one folder.
struct Expected {
    /// Vault-relative path of each managed bookmark, to its scanned revision.
    bookmarks: HashMap<String, Revision>,
    /// Vault-relative path of each managed directory.
    directories: Vec<String>,
    /// Vault-relative path of each nested `.bookmarks-but-better-folder.md`, to its revision.
    ///
    /// A directory whose metadata has no revision has no usable identity
    /// either, and is absent here — which makes it unknown, and blocks the
    /// delete, which is the right answer for a folder the vault cannot name.
    folder_metadata: HashMap<String, Revision>,
    /// Vault-relative path of each nested `.bookmarks-but-better-state.json`, to its revision.
    ///
    /// A folder with no order file is simply absent here, and one whose order
    /// file could not be read has no revision either — which makes the file
    /// unknown, and blocks the delete. That is the right answer: bytes the
    /// daemon cannot account for are not bytes it may destroy.
    folder_state: HashMap<String, Revision>,
    /// Vault-relative path of each `.assets` directory the scan implies.
    assets: Vec<String>,
}

/// Verifies that `folder` may be deleted whole.
///
/// `handle` must already be the folder's own directory, opened no-follow.
///
/// # Errors
///
/// Returns the first reason the subtree is not safe to delete.
pub(crate) fn verify_deletable(handle: &Dir, folder: &FolderNode) -> Result<(), SubtreeRefusal> {
    let mut expected = Expected {
        bookmarks: HashMap::new(),
        directories: Vec::new(),
        folder_metadata: HashMap::new(),
        folder_state: HashMap::new(),
        assets: Vec::new(),
    };
    collect(folder, &mut expected);

    let mut unknown = Vec::new();
    walk(handle, folder.relative_path(), &expected, &mut unknown)?;

    if !unknown.is_empty() {
        let total = unknown.len();
        unknown.truncate(LISTED_PATHS);
        return Err(SubtreeRefusal::Unknown {
            paths: unknown,
            total,
        });
    }
    Ok(())
}

fn collect(folder: &FolderNode, expected: &mut Expected) {
    expected.directories.push(folder.relative_path().to_owned());
    if let Some(revision) = folder.revision() {
        expected
            .folder_metadata
            .insert(join(folder.relative_path(), FOLDER_FILE_NAME), revision);
    }
    if let Some(revision) = folder.state_revision() {
        expected
            .folder_state
            .insert(join(folder.relative_path(), STATE_FILE_NAME), revision);
    }
    for bookmark in folder.bookmarks() {
        expected
            .bookmarks
            .insert(bookmark.relative_path().to_owned(), bookmark.revision());
        // A bookmark's assets live beside it and belong to it, so they are
        // managed by association even though the scanner does not descend.
        expected.assets.push(join(
            folder.relative_path(),
            &assets_directory_name(bookmark.file_name()),
        ));
    }
    for child in folder.folders() {
        collect(child, expected);
    }
}

fn walk(
    handle: &Dir,
    relative: &str,
    expected: &Expected,
    unknown: &mut Vec<String>,
) -> Result<(), SubtreeRefusal> {
    let entries = handle
        .entries()
        .map_err(|error| SubtreeRefusal::Unreadable {
            path: display(relative),
            error,
        })?;

    for entry in entries {
        let entry = entry.map_err(|error| SubtreeRefusal::Unreadable {
            path: display(relative),
            error,
        })?;
        let raw_name = entry.file_name();
        let Some(name) = raw_name.to_str() else {
            // A name the vault cannot even address is by definition not one it
            // manages, so it blocks the delete like any other unknown entry.
            unknown.push(join(relative, &raw_name.to_string_lossy()));
            continue;
        };
        let child = join(relative, name);

        let file_type = entry
            .file_type()
            .map_err(|error| SubtreeRefusal::Unreadable {
                path: child.clone(),
                error,
            })?;

        if file_type.is_symlink() {
            // A link is never followed and never managed; deleting the folder
            // would remove it, and the user may well care about it.
            unknown.push(child);
        } else if file_type.is_dir() {
            if expected.assets.contains(&child) {
                // Assets belong to their bookmark wholesale; their contents are
                // the user's files, kept and removed with the bookmark.
                continue;
            }
            if !expected.directories.contains(&child) {
                unknown.push(child);
                continue;
            }
            let child_handle =
                handle
                    .open_dir_nofollow(name)
                    .map_err(|error| SubtreeRefusal::Unreadable {
                        path: child.clone(),
                        error,
                    })?;
            walk(&child_handle, &child, expected, unknown)?;
        } else if file_type.is_file() {
            verify_file(handle, name, &child, expected, unknown)?;
        } else {
            unknown.push(child);
        }
    }

    // Every managed file the scan recorded here must still be present. One
    // that vanished means the subtree moved underneath the request.
    for path in expected
        .bookmarks
        .keys()
        .chain(expected.folder_metadata.keys())
        .chain(expected.folder_state.keys())
    {
        if parent_of(path) == relative && !handle.exists(file_name_of(path)) {
            return Err(SubtreeRefusal::Changed {
                path: path.clone(),
                reason: "was removed",
            });
        }
    }

    Ok(())
}

fn verify_file(
    handle: &Dir,
    name: &str,
    child: &str,
    expected: &Expected,
    unknown: &mut Vec<String>,
) -> Result<(), SubtreeRefusal> {
    if name == FOLDER_FILE_NAME {
        // A folder's metadata is checked exactly like a bookmark: it is a
        // managed file with a revision the scan recorded, and it carries the
        // identity of a directory this delete is about to destroy.
        let Some(revision) = expected.folder_metadata.get(child) else {
            unknown.push(child.to_owned());
            return Ok(());
        };
        return compare(handle, name, child, *revision);
    }

    if name == STATE_FILE_NAME {
        // And so is its child order, which records where everything in the
        // subtree sits. One changing means somebody rearranged a folder this
        // request was about to erase.
        let Some(revision) = expected.folder_state.get(child) else {
            unknown.push(child.to_owned());
            return Ok(());
        };
        return compare(handle, name, child, *revision);
    }

    let Some(revision) = expected.bookmarks.get(child) else {
        // Markdown with no `bookmarks_but_better_id`, a stray text file, an editor's swap file:
        // all of it is the user's, and none of it is ours to delete.
        unknown.push(child.to_owned());
        return Ok(());
    };

    compare(handle, name, child, *revision)
}

/// Refuses unless the file's current bytes match what the scan recorded.
fn compare(
    handle: &Dir,
    name: &str,
    child: &str,
    revision: Revision,
) -> Result<(), SubtreeRefusal> {
    let bytes = fsx::read(handle, name).map_err(|error| SubtreeRefusal::Unreadable {
        path: child.to_owned(),
        error,
    })?;
    if Revision::of(&bytes) != revision {
        return Err(SubtreeRefusal::Changed {
            path: child.to_owned(),
            reason: "changed on disk",
        });
    }
    Ok(())
}

fn join(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}/{name}")
    }
}

fn parent_of(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(parent, _)| parent)
}

fn file_name_of(path: &str) -> &str {
    path.rsplit_once('/').map_or(path, |(_, name)| name)
}

fn display(relative: &str) -> String {
    if relative.is_empty() {
        ".".to_owned()
    } else {
        relative.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bookmarks_but_better_vault_core::scan;

    /// A vault holding `Dev/Nested/` and a managed bookmark in each.
    fn vault_with_nested_folder() -> (tempfile::TempDir, VaultScanHolder) {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::init::initialize(directory.path()).expect("initialize");
        for (path, id) in [("Dev", "1111aaaa"), ("Dev/Nested", "3333cccc")] {
            std::fs::create_dir(directory.path().join(path)).expect("create dir");
            std::fs::write(
                directory.path().join(path).join(FOLDER_FILE_NAME),
                format!("---\nbookmarks_but_better_id: {id}\n---\n"),
            )
            .expect("folder metadata");
        }
        let scanned = scan(directory.path()).expect("scan");
        (directory, VaultScanHolder(scanned))
    }

    /// A vault holding `Dev/` with one managed bookmark inside it.
    fn vault_with_folder() -> (tempfile::TempDir, VaultScanHolder) {
        let directory = tempfile::tempdir().expect("temp dir");
        crate::init::initialize(directory.path()).expect("initialize");
        std::fs::create_dir(directory.path().join("Dev")).expect("create dir");
        std::fs::write(
            directory.path().join("Dev").join(FOLDER_FILE_NAME),
            "---\nbookmarks_but_better_id: 1111aaaa\n---\n",
        )
        .expect("folder metadata");
        std::fs::write(
            directory.path().join("Dev").join("React--2222bbbb.md"),
            "---\nbookmarks_but_better_id: 2222bbbb\nbookmarks_but_better_url: https://react.dev\nbookmarks_but_better_title: React\n\
             bookmarks_but_better_created: 2026-01-01T00:00:00Z\nbookmarks_but_better_updated: 2026-01-01T00:00:00Z\n---\n",
        )
        .expect("bookmark");

        let scanned = scan(directory.path()).expect("scan");
        (directory, VaultScanHolder(scanned))
    }

    /// Keeps the scan alive so borrowed nodes stay valid in a test.
    struct VaultScanHolder(bookmarks_but_better_vault_core::VaultScan);

    impl VaultScanHolder {
        fn folder(&self) -> &FolderNode {
            self.0.folder().folders().next().expect("one child folder")
        }
    }

    fn handle(directory: &std::path::Path) -> Dir {
        let root = fsx::open_root(directory).expect("open root");
        fsx::open_relative_dir(&root, "Dev").expect("open Dev")
    }

    #[test]
    fn a_fully_managed_subtree_is_deletable() {
        let (directory, scan) = vault_with_folder();
        verify_deletable(&handle(directory.path()), scan.folder()).expect("deletable");
    }

    #[test]
    fn a_bookmark_changed_after_the_scan_refuses_the_delete() {
        let (directory, scan) = vault_with_folder();

        // The editor saves while the request is in flight. The plan is stale,
        // and erasing the subtree on the strength of it would destroy an edit
        // the daemon never saw.
        std::fs::write(
            directory.path().join("Dev").join("React--2222bbbb.md"),
            "---\nbookmarks_but_better_id: 2222bbbb\nbookmarks_but_better_url: https://react.dev\nbookmarks_but_better_title: React 19\n\
             bookmarks_but_better_created: 2026-01-01T00:00:00Z\nbookmarks_but_better_updated: 2026-02-02T00:00:00Z\n---\n",
        )
        .expect("external edit");

        let refusal = verify_deletable(&handle(directory.path()), scan.folder())
            .expect_err("a changed subtree must refuse");
        assert!(
            matches!(refusal, SubtreeRefusal::Changed { .. }),
            "{refusal:?}"
        );
        assert!(
            refusal.detail().contains("rescan and retry"),
            "{}",
            refusal.detail()
        );
    }

    #[test]
    fn a_bookmark_removed_after_the_scan_refuses_the_delete() {
        let (directory, scan) = vault_with_folder();
        std::fs::remove_file(directory.path().join("Dev").join("React--2222bbbb.md"))
            .expect("remove");

        let refusal = verify_deletable(&handle(directory.path()), scan.folder())
            .expect_err("a subtree that lost an entry must refuse");
        assert!(
            matches!(refusal, SubtreeRefusal::Changed { .. }),
            "{refusal:?}"
        );
    }

    #[test]
    fn an_unmanaged_file_refuses_the_delete_and_is_named() {
        let (directory, scan) = vault_with_folder();
        std::fs::write(directory.path().join("Dev").join("thesis.txt"), "mine").expect("write");

        let refusal = verify_deletable(&handle(directory.path()), scan.folder())
            .expect_err("an unmanaged file must refuse");
        match &refusal {
            SubtreeRefusal::Unknown { paths, total } => {
                assert_eq!(*total, 1);
                assert_eq!(paths, &["Dev/thesis.txt".to_owned()]);
            }
            other => panic!("{other:?}"),
        }
        assert!(
            refusal.detail().contains("thesis.txt"),
            "{}",
            refusal.detail()
        );
    }

    #[test]
    fn many_unmanaged_files_are_summarised_rather_than_listed_in_full() {
        let (directory, scan) = vault_with_folder();
        for index in 0..10 {
            std::fs::write(
                directory
                    .path()
                    .join("Dev")
                    .join(format!("file{index}.txt")),
                "mine",
            )
            .expect("write");
        }

        let refusal = verify_deletable(&handle(directory.path()), scan.folder())
            .expect_err("unmanaged files must refuse");
        let detail = refusal.detail();
        assert!(detail.contains("10 entries"), "{detail}");
        assert!(detail.contains("and 7 more"), "{detail}");
    }

    #[test]
    fn a_nested_folder_metadata_change_refuses_the_delete() {
        let (directory, scan) = vault_with_nested_folder();
        verify_deletable(&handle(directory.path()), scan.folder()).expect("deletable as scanned");

        // A nested `.bookmarks-but-better-folder.md` carries the identity of a directory this
        // delete would destroy. One changing means a folder was re-identified
        // after the plan was made, which is exactly as disqualifying as a
        // bookmark changing.
        std::fs::write(
            directory.path().join("Dev/Nested").join(FOLDER_FILE_NAME),
            "---\nbookmarks_but_better_id: 3333cccc\nbookmarks_but_better_title: Renamed\n---\n",
        )
        .expect("external edit");

        let refusal = verify_deletable(&handle(directory.path()), scan.folder())
            .expect_err("a changed nested metadata file must refuse");
        match &refusal {
            SubtreeRefusal::Changed { path, .. } => {
                assert_eq!(path, "Dev/Nested/.bookmarks-but-better-folder.md");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_nested_folder_metadata_file_that_vanished_refuses_the_delete() {
        let (directory, scan) = vault_with_nested_folder();
        std::fs::remove_file(directory.path().join("Dev/Nested").join(FOLDER_FILE_NAME))
            .expect("remove");

        let refusal = verify_deletable(&handle(directory.path()), scan.folder())
            .expect_err("a missing nested metadata file must refuse");
        assert!(
            matches!(refusal, SubtreeRefusal::Changed { .. }),
            "{refusal:?}"
        );
    }

    #[test]
    fn a_nested_child_order_change_refuses_the_delete() {
        let (directory, scan) = vault_with_nested_folder();
        std::fs::write(
            directory.path().join("Dev/Nested").join(STATE_FILE_NAME),
            "{\n  \"version\": 1,\n  \"children\": []\n}\n",
        )
        .expect("seed order");
        let scan = {
            // Rescan so the order file is part of the plan, then change it.
            let _ = scan;
            VaultScanHolder(bookmarks_but_better_vault_core::scan(directory.path()).expect("scan"))
        };
        verify_deletable(&handle(directory.path()), scan.folder()).expect("deletable as scanned");

        // The order of a folder this delete is about to destroy changes while
        // the request is in flight. One revision covering `Dev` said nothing
        // about it, so the delete stops rather than erasing an arrangement the
        // daemon never saw.
        std::fs::write(
            directory.path().join("Dev/Nested").join(STATE_FILE_NAME),
            "{\n  \"version\": 1,\n  \"children\": []\n}\n\n",
        )
        .expect("external edit");

        let refusal = verify_deletable(&handle(directory.path()), scan.folder())
            .expect_err("a changed nested order must refuse");
        match &refusal {
            SubtreeRefusal::Changed { path, .. } => {
                assert_eq!(path, "Dev/Nested/.bookmarks-but-better-state.json");
            }
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_nested_child_order_that_vanished_refuses_the_delete() {
        let (directory, _) = vault_with_nested_folder();
        std::fs::write(
            directory.path().join("Dev/Nested").join(STATE_FILE_NAME),
            "{\n  \"version\": 1,\n  \"children\": []\n}\n",
        )
        .expect("seed order");
        let scan =
            VaultScanHolder(bookmarks_but_better_vault_core::scan(directory.path()).expect("scan"));
        std::fs::remove_file(directory.path().join("Dev/Nested").join(STATE_FILE_NAME))
            .expect("remove");

        let refusal = verify_deletable(&handle(directory.path()), scan.folder())
            .expect_err("a missing nested order must refuse");
        assert!(
            matches!(refusal, SubtreeRefusal::Changed { .. }),
            "{refusal:?}"
        );
    }

    #[test]
    fn a_bookmarks_assets_directory_does_not_block_the_delete() {
        let (directory, scan) = vault_with_folder();
        let assets = directory.path().join("Dev").join("React--2222bbbb.assets");
        std::fs::create_dir(&assets).expect("create assets");
        std::fs::write(assets.join("logo.png"), b"\x89PNG").expect("write logo");

        verify_deletable(&handle(directory.path()), scan.folder())
            .expect("assets belong to their bookmark");
    }
}
