//! Golden tests for the deterministic vault scan.

mod support;

use std::fmt::Write as _;
use std::fs;

use bbb_vault_core::{
    Access, BookmarkNode, DiagnosticCode, FolderNode, Id, ScanOptions, VaultScan, scan, scan_with,
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
        "{indent}folder {:?} id={} title={:?} access={}",
        display(folder.relative_path()),
        folder
            .id()
            .map_or_else(|| "-".to_owned(), |id| id.to_string()),
        folder.title(),
        folder.access().as_str()
    );
    for child in folder.folders() {
        render_folder(out, child, depth + 1);
    }
    for bookmark in folder.bookmarks() {
        render_bookmark(out, bookmark, depth + 1);
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

#[test]
fn siblings_are_ordered_folders_first_then_by_folded_title() {
    let scan = scan_fixture();
    let root = scan.folder();

    let folders: Vec<_> = root.folders().iter().map(FolderNode::title).collect();
    assert_eq!(folders, ["Archive", "Reading List"]);

    // Case-folded code point order: `apple` sorts before `Zebra` because the
    // fold ignores case, and `Éclair` sorts last because `é` is above `z` in
    // code point order. The rule is documented, not locale collation.
    let bookmarks: Vec<_> = root.bookmarks().iter().map(BookmarkNode::title).collect();
    assert_eq!(bookmarks, ["apple", "Zebra", "Éclair"]);
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

#[test]
fn a_duplicated_identity_makes_the_later_entry_read_only() {
    let scan = scan_fixture();
    let original = scan
        .folder()
        .bookmarks()
        .iter()
        .find(|bookmark| bookmark.relative_path() == "Zebra--z1z2z3z4.md")
        .expect("the original");
    assert_eq!(original.access(), Access::ReadWrite);

    let copy = scan
        .bookmarks()
        .find(|bookmark| bookmark.relative_path() == "archive/Copy of Zebra--z1z2z3z4.md")
        .expect("the copy");
    assert_eq!(copy.access(), Access::ReadOnly);
    assert!(
        copy.diagnostics()
            .iter()
            .any(|diagnostic| diagnostic.code() == DiagnosticCode::DuplicateId)
    );
}

#[test]
fn identity_survives_a_rename_and_a_move() {
    let temp = TempDir::new("move");
    temp.write(".bbb-folder.md", folder_source("r00tr00t", None));
    temp.write(
        "Archive/.bbb-folder.md",
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
    temp.write(".bbb-folder.md", folder_source("r00tr00t", None));
    let path = temp.write(
        "React--a1b2c3d4.md",
        bookmark_source("a1b2c3d4", "https://react.dev", "React"),
    );

    let before = scan(temp.path()).expect("a scan");
    let bookmark = before
        .find_bookmark(Id::parse("a1b2c3d4").unwrap())
        .unwrap();
    let source = fs::read(&path).unwrap();
    let file = bbb_vault_core::BookmarkFile::parse(&source).unwrap();
    let written = file
        .apply(
            &source,
            &bbb_vault_core::BookmarkUpdate::new().title("Preact"),
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
    temp.write(".bbb-folder.md", folder_source("r00tr00t", None));
    temp.write(
        "broken--b1b2b3b4.md",
        b"---\nbbb_id: b1b2b3b4\nbbb_title: \xff\xfe\n---\n".as_slice(),
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
    temp.write(".bbb-folder.md", folder_source("r00tr00t", None));
    temp.write(
        "a/b/c/.bbb-folder.md",
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
    temp.write(".bbb-folder.md", folder_source("r00tr00t", None));
    // Two directories whose names fold to the same key cannot both exist on
    // macOS or Windows, so copying this vault there would silently merge them.
    temp.write(
        "Work/.bbb-folder.md",
        folder_source("w0rk0000", Some("Work")),
    );
    temp.write(
        "work/.bbb-folder.md",
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
    assert_eq!(scan.folder().folders().len(), 2);
}

#[cfg(unix)]
#[test]
fn windows_device_names_are_reported() {
    let temp = TempDir::new("reserved");
    temp.write(".bbb-folder.md", folder_source("r00tr00t", None));
    temp.mkdir("con");
    temp.write(
        "con/.bbb-folder.md",
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

#[cfg(unix)]
#[test]
fn symbolic_links_are_never_followed() {
    use std::os::unix::fs::symlink;

    let outside = TempDir::new("outside");
    outside.write(
        "Secret--s1s2s3s4.md",
        bookmark_source("s1s2s3s4", "https://secret.example", "Secret"),
    );

    let temp = TempDir::new("symlink");
    temp.write(".bbb-folder.md", folder_source("r00tr00t", None));
    symlink(outside.path(), temp.path().join("linked")).expect("creating a directory link");
    symlink(
        outside.path().join("Secret--s1s2s3s4.md"),
        temp.path().join("Link--l1l2l3l4.md"),
    )
    .expect("creating a file link");

    let scan = scan(temp.path()).expect("a scan");
    assert_eq!(
        scan.bookmarks().count(),
        0,
        "nothing outside the vault is read"
    );
    let skipped: Vec<_> = scan
        .diagnostics()
        .into_iter()
        .filter(|diagnostic| diagnostic.code() == DiagnosticCode::SymlinkSkipped)
        .map(|diagnostic| diagnostic.path().unwrap_or_default().to_owned())
        .collect();
    assert_eq!(skipped, ["Link--l1l2l3l4.md", "linked"]);
}

#[test]
fn an_unreadable_root_is_an_error_rather_than_an_empty_vault() {
    let temp = TempDir::new("missing");
    let missing = temp.path().join("nope");
    assert!(scan(&missing).is_err());
}
