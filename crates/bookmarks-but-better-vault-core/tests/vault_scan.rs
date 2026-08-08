//! Golden tests for the deterministic vault scan.

mod support;

use std::fmt::Write as _;
use std::fs;

use bookmarks_but_better_vault_core::{
    Access, BookmarkNode, ChildNode, DiagnosticCode, FolderNode, Id, ScanOptions, VaultScan, scan,
    scan_with,
};

use support::{
    TempDir, assert_golden, bookmark_source, fixtures, folder_source, is_case_sensitive,
};

/// Renders a scan as stable text.
///
/// Absolute paths and revision digests are deliberately left out: the first is
/// machine-specific and the second is asserted separately, and neither belongs
/// in a diff a human has to read.
fn render(scan: &VaultScan) -> String {
    let mut out = String::new();
    render_folder(&mut out, scan.folder(), 0);
    out.push_str("\ndiagnostics:\n");
    for diagnostic in scan.diagnostics() {
        let _ = writeln!(
            out,
            "  {:<7} {:<24} {}{}",
            diagnostic.severity().as_str(),
            diagnostic.code().as_str(),
            diagnostic.path().unwrap_or("-"),
            diagnostic
                .line()
                .map_or_else(String::new, |line| format!(":{line}"))
        );
    }
    out
}

fn render_folder(out: &mut String, folder: &FolderNode, depth: usize) {
    let indent = "  ".repeat(depth);
    let _ = writeln!(
        out,
        "{indent}folder {:?} id={} title={:?} access={} order={}",
        display(folder.relative_path()),
        folder
            .id()
            .map_or_else(|| "-".to_owned(), |id| id.to_string()),
        folder.title(),
        folder.access().as_str(),
        folder.state_access().as_str()
    );
    // The mixed list, in the one order the vault says its children are in.
    for child in folder.children() {
        match child {
            ChildNode::Folder(child) => render_folder(out, child, depth + 1),
            ChildNode::Bookmark(child) => render_bookmark(out, child, depth + 1),
        }
    }
}

fn render_bookmark(out: &mut String, bookmark: &BookmarkNode, depth: usize) {
    let indent = "  ".repeat(depth);
    let _ = writeln!(
        out,
        "{indent}bookmark {:?} id={} title={:?} url={:?} logo={:?} access={}",
        bookmark.relative_path(),
        bookmark.id(),
        bookmark.title(),
        bookmark.url().unwrap_or("-"),
        bookmark.logo().unwrap_or("-"),
        bookmark.access().as_str()
    );
}

fn display(relative_path: &str) -> &str {
    if relative_path.is_empty() {
        "."
    } else {
        relative_path
    }
}

fn scan_fixture() -> VaultScan {
    scan(&fixtures().join("vault")).expect("the fixture vault is readable")
}

#[test]
fn the_fixture_vault_matches_its_golden_rendering() {
    assert_golden("vault.golden.txt", &render(&scan_fixture()));
}

#[test]
fn scanning_twice_produces_identical_output() {
    assert_eq!(render(&scan_fixture()), render(&scan_fixture()));
}

/// A folder with no `.bookmarks-but-better-state.json` is shown in migration order: folders
/// first, then by the creation timestamp each entry carries and its stable
/// identity. Nothing here depends on the title, the filesystem's listing order
/// or the platform, which is what makes it the same everywhere.
#[test]
fn a_folder_without_recorded_order_uses_the_migration_order() {
    let scan = scan_fixture();
    let root = scan.folder();

    let folders: Vec<_> = root.folders().map(FolderNode::title).collect();
    assert_eq!(
        folders,
        ["Archive", "Reading List"],
        "arch1ve0 comes before read1ist"
    );

    // All three share a creation timestamp, so the identity decides.
    let bookmarks: Vec<_> = root.bookmarks().map(BookmarkNode::title).collect();
    assert_eq!(bookmarks, ["apple", "Éclair", "Zebra"]);

    // And the mixed list puts the two groups in that same order.
    let children: Vec<_> = root.children().iter().map(ChildNode::title).collect();
    assert_eq!(
        children,
        ["Archive", "Reading List", "apple", "Éclair", "Zebra"]
    );
}

#[test]
fn ordinary_files_and_foreign_directories_are_ignored() {
    let scan = scan_fixture();
    let paths: Vec<_> = scan
        .bookmarks()
        .map(BookmarkNode::relative_path)
        .collect::<Vec<_>>();

    assert!(!paths.iter().any(|path| path.contains("README")));
    assert!(!paths.iter().any(|path| path.contains(".obsidian")));
    assert!(!paths.iter().any(|path| path.contains("notes.txt")));
    assert!(!paths.iter().any(|path| path.contains(".assets")));
    // Ordinary Markdown produces no diagnostic at all: a vault is a normal
    // directory tree and the user's own notes are none of its business.
    assert!(
        !scan.diagnostics().iter().any(|diagnostic| diagnostic
            .path()
            .is_some_and(|path| path.contains("README"))),
        "an ordinary note must not be reported as a problem"
    );
}

#[test]
fn malformed_files_become_diagnostics_rather_than_entries() {
    let scan = scan_fixture();
    let by_code = |code: DiagnosticCode| {
        scan.diagnostics()
            .into_iter()
            .filter(move |diagnostic| diagnostic.code() == code)
            .map(|diagnostic| diagnostic.path().unwrap_or_default().to_owned())
            .collect::<Vec<_>>()
    };

    assert_eq!(
        by_code(DiagnosticCode::UnterminatedFrontmatter),
        ["Reading list/broken/unterminated--u1u2u3u4.md"]
    );
    assert_eq!(
        by_code(DiagnosticCode::InvalidUtf8),
        ["Reading list/broken/mojibake--m1m2m3m4.md"]
    );
    assert_eq!(
        by_code(DiagnosticCode::MissingFolderMetadata),
        ["Reading list/broken"]
    );
    assert_eq!(
        by_code(DiagnosticCode::FilenameIdMismatch),
        ["Reading list/renamed-by-hand.md"]
    );
    assert!(scan.find_bookmark(Id::parse("u1u2u3u4").unwrap()).is_none());
    assert!(scan.find_bookmark(Id::parse("m1m2m3m4").unwrap()).is_none());
}

/// Nothing distinguishes a copy from its original, so neither may be written.
///
/// Demoting only the "later" one would make traversal order decide which file a
/// write lands on, which is exactly the silent-overwrite the vault exists to
/// prevent.
#[test]
fn every_claimant_of_a_duplicated_identity_is_read_only() {
    let scan = scan_fixture();
    let id = Id::parse("z1z2z3z4").unwrap();

    let claimants = scan.bookmarks_claiming(id);
    let paths: Vec<_> = claimants
        .iter()
        .map(|bookmark| bookmark.relative_path())
        .collect();
    assert_eq!(
        paths,
        ["archive/Copy of Zebra--z1z2z3z4.md", "Zebra--z1z2z3z4.md"]
    );

    for bookmark in &claimants {
        assert_eq!(
            bookmark.access(),
            Access::ReadOnly,
            "{} stayed writable",
            bookmark.relative_path()
        );
        let duplicate = bookmark
            .diagnostics()
            .iter()
            .find(|diagnostic| diagnostic.code() == DiagnosticCode::DuplicateId)
            .expect("a duplicate-identity diagnostic");
        assert_eq!(duplicate.path(), Some(bookmark.relative_path()));
        // The diagnostic names every *other* claimant, so a human can act on it.
        for other in &paths {
            if *other == bookmark.relative_path() {
                continue;
            }
            assert!(
                duplicate.detail().contains(other),
                "{} must point at {other}: {}",
                bookmark.relative_path(),
                duplicate.detail()
            );
        }
    }

    // An ambiguous identity has no answer, so the lookup refuses to invent one.
    assert!(
        scan.find_bookmark(id).is_none(),
        "an ambiguous lookup must not pick a winner"
    );
    // An unambiguous one still resolves.
    let unique = Id::parse("o1o2o3o4").unwrap();
    assert_eq!(
        scan.find_bookmark(unique).map(BookmarkNode::relative_path),
        Some("archive/Old--o1o2o3o4.md")
    );
    assert!(scan.find_bookmark(Id::parse("00000000").unwrap()).is_none());
}

#[test]
fn duplicated_folder_identities_are_refused_the_same_way() {
    let temp = TempDir::new("dupe-folders");
    temp.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    temp.write(
        "One/.bookmarks-but-better-folder.md",
        folder_source("same0000", Some("One")),
    );
    temp.write(
        "Two/.bookmarks-but-better-folder.md",
        folder_source("same0000", Some("Two")),
    );

    let scan = scan(temp.path()).expect("a scan");
    let id = Id::parse("same0000").unwrap();
    assert_eq!(scan.folders_claiming(id).len(), 2);
    assert!(scan.find_folder(id).is_none());
    for folder in scan.folders_claiming(id) {
        assert_eq!(
            folder.access(),
            Access::ReadOnly,
            "{}",
            folder.relative_path()
        );
    }
}

#[test]
fn identity_survives_a_rename_and_a_move() {
    let temp = TempDir::new("move");
    temp.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    temp.write(
        "Archive/.bookmarks-but-better-folder.md",
        folder_source("arch1ve0", Some("Archive")),
    );
    let original = temp.write(
        "React--a1b2c3d4.md",
        bookmark_source("a1b2c3d4", "https://react.dev", "React"),
    );

    let before = scan(temp.path()).expect("a scan");
    let found = before
        .find_bookmark(Id::parse("a1b2c3d4").unwrap())
        .expect("the bookmark");
    assert_eq!(found.relative_path(), "React--a1b2c3d4.md");
    let revision = found.revision();

    // Rename the readable part and move it into a subdirectory, exactly as a
    // user would in a file manager. The bytes never change.
    let moved = temp
        .path()
        .join("Archive/A completely different name--a1b2c3d4.md");
    fs::rename(&original, &moved).expect("moving the bookmark");

    let after = scan(temp.path()).expect("a rescan");
    let found = after
        .find_bookmark(Id::parse("a1b2c3d4").unwrap())
        .expect("the bookmark is still there");
    assert_eq!(
        found.relative_path(),
        "Archive/A completely different name--a1b2c3d4.md"
    );
    assert_eq!(found.title(), "React", "the title lives in front matter");
    assert_eq!(
        found.revision(),
        revision,
        "identical bytes, identical revision"
    );
    assert_eq!(found.access(), Access::ReadWrite);
}

#[test]
fn a_title_change_does_not_change_the_identity() {
    let temp = TempDir::new("retitle");
    temp.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    let path = temp.write(
        "React--a1b2c3d4.md",
        bookmark_source("a1b2c3d4", "https://react.dev", "React"),
    );

    let before = scan(temp.path()).expect("a scan");
    let bookmark = before
        .find_bookmark(Id::parse("a1b2c3d4").unwrap())
        .unwrap();
    let source = fs::read(&path).unwrap();
    let file = bookmarks_but_better_vault_core::BookmarkFile::parse(&source).unwrap();
    let written = file
        .apply(
            &source,
            &bookmarks_but_better_vault_core::BookmarkUpdate::new().title("Preact"),
        )
        .unwrap();
    fs::write(&path, &written).unwrap();

    let after = scan(temp.path()).expect("a rescan");
    let renamed = after
        .find_bookmark(Id::parse("a1b2c3d4").unwrap())
        .expect("same identity");
    assert_eq!(renamed.title(), "Preact");
    assert_eq!(renamed.relative_path(), bookmark.relative_path());
    assert_ne!(renamed.revision(), bookmark.revision());
}

#[test]
fn invalid_utf8_and_oversized_files_are_read_only_diagnostics() {
    let temp = TempDir::new("unreadable");
    temp.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    temp.write(
        "broken--b1b2b3b4.md",
        b"---\nbookmarks_but_better_id: b1b2b3b4\nbookmarks_but_better_title: \xff\xfe\n---\n"
            .as_slice(),
    );
    temp.write(
        "huge--h1h2h3h4.md",
        format!(
            "{}{}",
            bookmark_source("h1h2h3h4", "https://example.com", "Huge"),
            "padding\n".repeat(500)
        ),
    );

    let scan =
        scan_with(temp.path(), ScanOptions::new().with_max_file_bytes(1024)).expect("a scan");
    let codes: Vec<_> = scan
        .diagnostics()
        .iter()
        .map(|diagnostic| diagnostic.code())
        .collect();
    assert!(codes.contains(&DiagnosticCode::InvalidUtf8), "{codes:?}");
    assert!(codes.contains(&DiagnosticCode::FileTooLarge), "{codes:?}");
    assert_eq!(scan.bookmarks().count(), 0);
}

#[test]
fn the_depth_limit_is_reported_rather_than_silently_truncating() {
    let temp = TempDir::new("depth");
    temp.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    temp.write(
        "a/b/c/.bookmarks-but-better-folder.md",
        folder_source("deep0000", Some("Deep")),
    );

    let scan = scan_with(temp.path(), ScanOptions::new().with_max_depth(1)).expect("a scan");
    assert!(
        scan.diagnostics()
            .iter()
            .any(|diagnostic| diagnostic.code() == DiagnosticCode::MaxDepthExceeded),
        "the limit must be visible"
    );
}

#[test]
fn case_insensitive_sibling_collisions_are_reported() {
    let temp = TempDir::new("case");
    if !is_case_sensitive(temp.path()) {
        // Nothing to prove: the filesystem already refuses the collision.
        return;
    }
    temp.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    // Two directories whose names fold to the same key cannot both exist on
    // macOS or Windows, so copying this vault there would silently merge them.
    temp.write(
        "Work/.bookmarks-but-better-folder.md",
        folder_source("w0rk0000", Some("Work")),
    );
    temp.write(
        "work/.bookmarks-but-better-folder.md",
        folder_source("w0rk1111", Some("work")),
    );

    let scan = scan(temp.path()).expect("a scan");
    let collisions: Vec<_> = scan
        .diagnostics()
        .into_iter()
        .filter(|diagnostic| diagnostic.code() == DiagnosticCode::NonPortableName)
        .collect();
    assert_eq!(collisions.len(), 1, "{collisions:?}");
    assert_eq!(collisions[0].path(), Some("work"));
    assert_eq!(scan.folder().folders().count(), 2);
}

#[cfg(unix)]
#[test]
fn windows_device_names_are_reported() {
    let temp = TempDir::new("reserved");
    temp.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    temp.mkdir("con");
    temp.write(
        "con/.bookmarks-but-better-folder.md",
        folder_source("c0nc0nc0", Some("Console")),
    );

    let scan = scan(temp.path()).expect("a scan");
    assert!(
        scan.diagnostics().iter().any(|diagnostic| {
            diagnostic.code() == DiagnosticCode::NonPortableName && diagnostic.path() == Some("con")
        }),
        "{:?}",
        scan.diagnostics()
    );
}

/// A vault must never read, or be redirected by, anything outside itself.
///
/// The traversal holds a directory handle and resolves each child against it
/// with the no-follow flag, so these cases fail at the `openat` rather than
/// being caught by a check that a racing rename could invalidate.
#[cfg(unix)]
#[test]
fn symbolic_links_are_never_followed() {
    use std::os::unix::fs::symlink;

    let outside = TempDir::new("outside");
    outside.write(
        "Secret--s1s2s3s4.md",
        bookmark_source("s1s2s3s4", "https://secret.example", "Secret"),
    );
    outside.write(
        ".bookmarks-but-better-folder.md",
        folder_source("0uts1de0", Some("Outside")),
    );

    let temp = TempDir::new("symlink");
    temp.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    // A directory link out of the vault.
    symlink(outside.path(), temp.path().join("linked")).expect("a directory link");
    // A file link out of the vault, wearing a valid bookmark name.
    symlink(
        outside.path().join("Secret--s1s2s3s4.md"),
        temp.path().join("Link--l1l2l3l4.md"),
    )
    .expect("a file link");
    // A link standing in for a folder's identity file: following this would let
    // anything outside the vault name a directory inside it.
    temp.mkdir("hijacked");
    symlink(
        outside.path().join(".bookmarks-but-better-folder.md"),
        temp.path().join("hijacked/.bookmarks-but-better-folder.md"),
    )
    .expect("a metadata link");
    // A link that points nowhere at all.
    symlink(
        outside.path().join("gone.md"),
        temp.path().join("Dangling--d1d2d3d4.md"),
    )
    .expect("a dangling link");
    // A link back to the parent, which would loop forever if followed.
    symlink(temp.path(), temp.path().join("loop")).expect("a cyclic link");

    let scan = scan(temp.path()).expect("a scan");
    assert_eq!(
        scan.bookmarks().count(),
        0,
        "nothing outside the vault may be read"
    );
    assert!(
        scan.find_bookmark(Id::parse("s1s2s3s4").unwrap()).is_none(),
        "the linked bookmark must not appear"
    );
    // The hijacked directory got no identity from the link.
    let hijacked = scan
        .folder()
        .folders()
        .find(|folder| folder.relative_path() == "hijacked")
        .expect("the directory itself is still listed");
    assert_eq!(
        hijacked.id(),
        None,
        "a linked metadata file must not be read"
    );
    assert!(scan.find_folder(Id::parse("0uts1de0").unwrap()).is_none());

    let skipped: Vec<_> = scan
        .diagnostics()
        .into_iter()
        .filter(|diagnostic| diagnostic.code() == DiagnosticCode::SymlinkSkipped)
        .map(|diagnostic| diagnostic.path().unwrap_or_default().to_owned())
        .collect();
    assert_eq!(
        skipped,
        [
            "Dangling--d1d2d3d4.md",
            "Link--l1l2l3l4.md",
            "linked",
            "loop",
            "hijacked/.bookmarks-but-better-folder.md",
        ],
        "every link must be reported, not silently dropped"
    );
}

/// A vault root that is itself a link is refused outright.
#[cfg(unix)]
#[test]
fn a_symlinked_vault_root_is_refused() {
    use std::os::unix::fs::symlink;

    let real = TempDir::new("real-root");
    real.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    real.write(
        "Note--n1n2n3n4.md",
        bookmark_source("n1n2n3n4", "https://example.com", "Note"),
    );

    let holder = TempDir::new("root-holder");
    let link = holder.path().join("vault");
    symlink(real.path(), &link).expect("a root link");

    // The real directory scans.
    assert_eq!(scan(real.path()).expect("a scan").bookmarks().count(), 1);
    // The link to it does not.
    let error = scan(&link).expect_err("a symlinked root must be refused");
    assert!(
        error.to_string().contains("vault root"),
        "the error must say what is wrong: {error}"
    );
}

/// Reading is bounded by the open handle, not by a size observed beforehand.
#[cfg(unix)]
#[test]
fn a_file_swapped_for_a_link_after_listing_is_not_followed() {
    use std::fs;
    use std::os::unix::fs::symlink;

    let outside = TempDir::new("swap-target");
    let secret = outside.path().join("secret.md");
    fs::write(
        &secret,
        bookmark_source("s9s9s9s9", "https://secret.example", "Secret"),
    )
    .expect("the target");

    let temp = TempDir::new("swap");
    temp.write(
        ".bookmarks-but-better-folder.md",
        folder_source("r00tr00t", None),
    );
    let victim = temp.write(
        "Victim--v1v2v3v4.md",
        bookmark_source("v1v2v3v4", "https://example.com", "Victim"),
    );

    // Stand in for losing the race: by the time the file is opened, the name
    // resolves to a link. The traversal re-resolves through the directory
    // handle with no-follow, so this is refused rather than read.
    fs::remove_file(&victim).expect("removing the victim");
    symlink(&secret, &victim).expect("swapping in a link");

    let scan = scan(temp.path()).expect("a scan");
    assert_eq!(scan.bookmarks().count(), 0);
    assert!(scan.find_bookmark(Id::parse("s9s9s9s9").unwrap()).is_none());
}

#[test]
fn an_unreadable_root_is_an_error_rather_than_an_empty_vault() {
    let temp = TempDir::new("missing");
    let missing = temp.path().join("nope");
    assert!(scan(&missing).is_err());
}
