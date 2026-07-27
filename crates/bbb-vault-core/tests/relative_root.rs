//! Vault roots given as bare relative names.
//!
//! A bare name like `vault` has an empty parent, which is the one shape of root
//! that cannot be resolved against an explicit parent path. It has to resolve
//! against the working directory instead, and it must be exactly as safe as an
//! absolute root: the name is a directory entry someone can replace with a link.
//!
//! # Why this is its own test binary
//!
//! Exercising a relative root means changing the process working directory, and
//! that is process-wide state. Cargo gives every `tests/*.rs` file its own
//! binary and therefore its own process, so the change is contained here. This
//! file deliberately holds a **single** test: two tests in one binary would run
//! on separate threads and fight over the same working directory.

mod support;

use std::path::{Path, PathBuf};

use bbb_vault_core::{BookmarkNode, Id, scan};

use support::{TempDir, bookmark_source, folder_source};

/// Restores the working directory however the test ends.
struct WorkingDirectory(PathBuf);

impl WorkingDirectory {
    fn set(to: &Path) -> Self {
        let previous = std::env::current_dir().expect("a working directory");
        std::env::set_current_dir(to).expect("entering the test directory");
        Self(previous)
    }
}

impl Drop for WorkingDirectory {
    fn drop(&mut self) {
        let _ = std::env::set_current_dir(&self.0);
    }
}

#[test]
fn a_bare_relative_root_resolves_against_the_working_directory_and_still_refuses_links() {
    let workspace = TempDir::new("relative-root");
    workspace.write("vault/.bbb-folder.md", folder_source("r00tr00t", None));
    workspace.write(
        "vault/Note--n1n2n3n4.md",
        bookmark_source("n1n2n3n4", "https://example.com", "Note"),
    );

    // Somewhere the vault must never reach.
    workspace.write("outside/.bbb-folder.md", folder_source("0uts1de0", None));
    workspace.write(
        "outside/Secret--s1s2s3s4.md",
        bookmark_source("s1s2s3s4", "https://secret.example", "Secret"),
    );

    let absolute = workspace.path().join("vault");
    let note = Id::parse("n1n2n3n4").expect("a valid id");
    let secret = Id::parse("s1s2s3s4").expect("a valid id");

    // The absolute form is the behaviour everything else is measured against.
    let by_absolute = scan(&absolute).expect("an absolute root scans");
    assert_eq!(by_absolute.bookmarks().count(), 1);
    assert!(by_absolute.find_bookmark(note).is_some());
    assert!(
        by_absolute.find_bookmark(secret).is_none(),
        "the sibling directory is not part of this vault"
    );

    let _cwd = WorkingDirectory::set(workspace.path());

    // A bare name, with no `./` and no parent component at all.
    let by_bare_name = scan(Path::new("vault")).expect("a bare relative root scans");
    assert_eq!(by_bare_name.bookmarks().count(), 1);
    assert_eq!(
        by_bare_name
            .find_bookmark(note)
            .map(BookmarkNode::relative_path),
        Some("Note--n1n2n3n4.md"),
        "a relative root must produce the same vault-relative paths as an absolute one"
    );
    assert_eq!(by_bare_name.folder().id(), by_absolute.folder().id());

    // The explicitly relative form takes the same path through the code.
    assert_eq!(
        scan(Path::new("./vault"))
            .expect("`./vault` scans")
            .bookmarks()
            .count(),
        1
    );

    // `.` names no directory entry, so there is nothing a link could be
    // substituted for; it opens directly.
    {
        let _inner = WorkingDirectory::set(&absolute);
        assert_eq!(
            scan(Path::new(".")).expect("`.` scans").bookmarks().count(),
            1
        );
    }

    // A relative root reaching up and back down is still a name at the end.
    {
        let _inner = WorkingDirectory::set(&workspace.path().join("outside"));
        assert_eq!(
            scan(Path::new("../vault"))
                .expect("`../vault` scans")
                .bookmarks()
                .count(),
            1
        );
    }

    #[cfg(unix)]
    links_are_refused_wherever_they_appear(&workspace, secret);
}

/// Every shape of link standing in for a bare relative root.
///
/// Split out only to keep the single test readable; it is not a second test and
/// must not become one, because it shares the working directory.
#[cfg(unix)]
fn links_are_refused_wherever_they_appear(workspace: &TempDir, secret: Id) {
    use std::fs;
    use std::os::unix::fs::symlink;

    // A bare relative name that is a link into another directory. Following it
    // would let the vault read `outside`, and would mean a relative root is
    // checked less strictly than an absolute one.
    symlink(
        workspace.path().join("outside"),
        workspace.path().join("linked"),
    )
    .expect("a link to another vault");
    let error = scan(Path::new("linked")).expect_err("a linked bare root is refused");
    assert!(
        error.to_string().contains("vault root"),
        "the error must say what is wrong: {error}"
    );
    assert!(
        scan(Path::new("linked")).is_err(),
        "the refusal is not one-shot"
    );

    // A *relative* link, which stays inside the sandbox and is therefore caught
    // only by the no-follow open, not by any containment check.
    symlink("vault", workspace.path().join("shortcut")).expect("a relative link");
    assert!(scan(Path::new("shortcut")).is_err());

    // A link that points nowhere is an error, not an empty vault.
    symlink("nowhere", workspace.path().join("dangling")).expect("a dangling link");
    assert!(scan(Path::new("dangling")).is_err());

    // Swapping the name for a link between two scans stands in for losing the
    // race. The name is resolved with no-follow against a handle on the working
    // directory, so there is no window in which a check has already passed: the
    // second scan is refused rather than reading `outside`.
    fs::rename(
        workspace.path().join("vault"),
        workspace.path().join("vault-moved"),
    )
    .expect("moving the real vault aside");
    symlink(
        workspace.path().join("outside"),
        workspace.path().join("vault"),
    )
    .expect("swapping a link in");

    assert!(
        scan(Path::new("vault")).is_err(),
        "a name swapped for a link must be refused, not followed"
    );
    assert!(
        scan(Path::new("vault-moved"))
            .expect("the real vault is still readable")
            .find_bookmark(secret)
            .is_none(),
        "nothing from outside the vault may ever appear"
    );
}
