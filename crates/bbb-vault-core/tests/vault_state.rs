//! How a folder's `.bbb-state.json` decides the order its children come back in.
//!
//! Every test here builds a vault on disk and scans it, so what is asserted is
//! the behaviour a daemon — or a user with a text editor — actually gets.

mod support;

use bbb_vault_core::{
    ChildKind, ChildNode, DiagnosticCode, FolderState, Id, STATE_FILE_NAME, ScanOptions,
    StateAccess, StateChild, VaultScan, scan, scan_with,
};

use support::{TempDir, bookmark_source, folder_source};

/// Four children with distinct identities: two bookmarks and two folders.
///
/// The creation timestamps are staggered so the migration order is unambiguous
/// and different from every hand-written order the tests then ask for.
fn vault() -> TempDir {
    let dir = TempDir::new("state");
    dir.write(".bbb-folder.md", folder_source("r00tr00t", None));
    dir.write(
        "Alpha--aaaaaaaa.md",
        bookmark_source("aaaaaaaa", "https://a.example", "Alpha"),
    );
    dir.write(
        "Beta--bbbbbbbb.md",
        bookmark_source("bbbbbbbb", "https://b.example", "Beta"),
    );
    dir.write("Dev/.bbb-folder.md", folder_source("dddddddd", Some("Dev")));
    dir.write("Ops/.bbb-folder.md", folder_source("eeeeeeee", Some("Ops")));
    dir
}

fn child_ids(scan: &VaultScan) -> Vec<String> {
    scan.folder()
        .children()
        .iter()
        .map(|child| {
            child
                .id()
                .map_or_else(|| "-".to_owned(), |id| id.to_string())
        })
        .collect()
}

fn state(children: &[(&str, ChildKind)]) -> String {
    let children = children
        .iter()
        .map(|(id, kind)| {
            StateChild::new(
                Id::parse(id).expect("a valid id"),
                *kind,
                "2026-01-01T00:00:00Z",
            )
        })
        .collect();
    String::from_utf8(FolderState::new(children).render()).expect("utf-8")
}

fn diagnostic_codes(scan: &VaultScan) -> Vec<DiagnosticCode> {
    scan.diagnostics()
        .into_iter()
        .map(bbb_vault_core::Diagnostic::code)
        .collect()
}

#[test]
fn a_recorded_order_interleaves_bookmarks_and_folders() {
    let dir = vault();
    dir.write(
        STATE_FILE_NAME,
        state(&[
            ("bbbbbbbb", ChildKind::Bookmark),
            ("eeeeeeee", ChildKind::Folder),
            ("aaaaaaaa", ChildKind::Bookmark),
            ("dddddddd", ChildKind::Folder),
        ]),
    );

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(
        child_ids(&scanned),
        ["bbbbbbbb", "eeeeeeee", "aaaaaaaa", "dddddddd"],
        "the recorded order wins over folders-first entirely"
    );
    assert_eq!(scanned.folder().state_access(), StateAccess::ReadWrite);
    assert!(scanned.folder().state_revision().is_some());
}

#[test]
fn a_folder_with_no_recorded_order_has_no_revision_and_is_writable() {
    let scanned = scan(vault().path()).expect("scan");
    assert_eq!(scanned.folder().state_access(), StateAccess::Absent);
    assert_eq!(scanned.folder().state_revision(), None);
    assert!(
        scanned.folder().state_access().is_writable(),
        "an absent order file is written the first time one is needed"
    );
}

#[test]
fn children_the_order_does_not_name_are_appended_without_disturbing_it() {
    let dir = vault();
    dir.write(
        STATE_FILE_NAME,
        state(&[
            ("eeeeeeee", ChildKind::Folder),
            ("bbbbbbbb", ChildKind::Bookmark),
        ]),
    );

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(
        child_ids(&scanned),
        ["eeeeeeee", "bbbbbbbb", "dddddddd", "aaaaaaaa"],
        "the two listed children keep their places and the rest follow in \
         migration order"
    );
    assert_eq!(
        scanned.folder().state_access(),
        StateAccess::ReadWrite,
        "an incomplete order is normal, not a problem"
    );
}

#[test]
fn a_child_the_order_names_but_the_folder_does_not_hold_is_hidden_and_reported() {
    let dir = vault();
    dir.write(
        STATE_FILE_NAME,
        state(&[
            ("aaaaaaaa", ChildKind::Bookmark),
            ("99999999", ChildKind::Bookmark),
            ("bbbbbbbb", ChildKind::Bookmark),
        ]),
    );

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(
        child_ids(&scanned),
        ["aaaaaaaa", "bbbbbbbb", "dddddddd", "eeeeeeee"],
        "the missing one takes up no space"
    );
    assert!(
        diagnostic_codes(&scanned).contains(&DiagnosticCode::StateMissingChild),
        "{:?}",
        diagnostic_codes(&scanned)
    );
    assert_eq!(
        scanned.folder().state_access(),
        StateAccess::ReadWrite,
        "a reference to something that has not arrived yet must not freeze the \
         file, or a slow sync would take ordering away"
    );
}

#[test]
fn one_identity_listed_twice_freezes_the_file_and_keeps_the_first_place() {
    let dir = vault();
    dir.write(
        STATE_FILE_NAME,
        state(&[
            ("bbbbbbbb", ChildKind::Bookmark),
            ("aaaaaaaa", ChildKind::Bookmark),
            ("bbbbbbbb", ChildKind::Bookmark),
        ]),
    );

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(
        child_ids(&scanned),
        ["bbbbbbbb", "aaaaaaaa", "dddddddd", "eeeeeeee"]
    );
    assert_eq!(scanned.folder().state_access(), StateAccess::ReadOnly);
    assert!(diagnostic_codes(&scanned).contains(&DiagnosticCode::StateNotRewritable));
}

#[test]
fn an_order_that_disagrees_about_a_kind_freezes_the_file() {
    let dir = vault();
    dir.write(
        STATE_FILE_NAME,
        state(&[
            // `dddddddd` is a directory on disk.
            ("dddddddd", ChildKind::Bookmark),
            ("aaaaaaaa", ChildKind::Bookmark),
        ]),
    );

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(
        child_ids(&scanned),
        ["aaaaaaaa", "dddddddd", "eeeeeeee", "bbbbbbbb"],
        "the entry the order was wrong about falls back to migration order"
    );
    assert_eq!(scanned.folder().state_access(), StateAccess::ReadOnly);
    assert!(diagnostic_codes(&scanned).contains(&DiagnosticCode::StateWrongKind));
}

#[test]
fn an_unknown_key_is_honoured_for_order_and_never_rewritten() {
    let dir = vault();
    dir.write(
        STATE_FILE_NAME,
        r#"{"version":1,"children":[
             {"id":"bbbbbbbb","kind":"bookmark","addedAt":"2026-01-01T00:00:00Z"},
             {"id":"aaaaaaaa","kind":"bookmark","addedAt":"2026-01-01T00:00:00Z"}],
           "pinned":["aaaaaaaa"]}"#,
    );

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(
        child_ids(&scanned),
        ["bbbbbbbb", "aaaaaaaa", "dddddddd", "eeeeeeee"],
        "a key from a newer version must not cost the user their order"
    );
    assert_eq!(
        scanned.folder().state_access(),
        StateAccess::ReadOnly,
        "but rewriting the file would throw that key away"
    );
    assert!(diagnostic_codes(&scanned).contains(&DiagnosticCode::StateNotRewritable));
}

#[test]
fn a_malformed_order_falls_back_to_migration_order_and_is_reported() {
    for (label, body) in [
        ("not json", "{ not json"),
        (
            "a repeated key",
            r#"{"version":1,"version":1,"children":[]}"#,
        ),
        ("no children", r#"{"version":1}"#),
        (
            "a bad identity",
            r#"{"version":1,"children":[{"id":"NOPE","kind":"folder","addedAt":"x"}]}"#,
        ),
        (
            "an unknown kind",
            r#"{"version":1,"children":[{"id":"aaaaaaaa","kind":"widget","addedAt":"x"}]}"#,
        ),
    ] {
        let dir = vault();
        dir.write(STATE_FILE_NAME, body);

        let scanned = scan(dir.path()).expect("scan");
        assert_eq!(
            child_ids(&scanned),
            ["dddddddd", "eeeeeeee", "aaaaaaaa", "bbbbbbbb"],
            "{label}: an unreadable order leaves the migration order in place"
        );
        assert_eq!(
            scanned.folder().state_access(),
            StateAccess::ReadOnly,
            "{label}"
        );
        assert!(
            diagnostic_codes(&scanned).contains(&DiagnosticCode::StateMalformed),
            "{label}: {:?}",
            diagnostic_codes(&scanned)
        );
        assert!(
            scanned.folder().state_revision().is_some(),
            "{label}: the bytes were read, so there is a revision to be stale against"
        );
    }
}

#[test]
fn an_order_from_a_future_version_is_refused_by_version() {
    let dir = vault();
    dir.write(STATE_FILE_NAME, r#"{"version":99,"children":[]}"#);

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(scanned.folder().state_access(), StateAccess::ReadOnly);
    let codes = diagnostic_codes(&scanned);
    assert!(
        codes.contains(&DiagnosticCode::StateUnsupportedVersion),
        "{codes:?}"
    );
}

#[test]
fn an_order_file_past_the_size_limit_is_never_read_or_written() {
    let dir = vault();
    dir.write(
        STATE_FILE_NAME,
        format!(
            r#"{{"version":1,"children":[],"padding":"{}"}}"#,
            "x".repeat(4096)
        ),
    );

    let scanned = scan_with(dir.path(), ScanOptions::new().with_max_file_bytes(512)).expect("scan");
    assert_eq!(scanned.folder().state_access(), StateAccess::ReadOnly);
    assert_eq!(
        scanned.folder().state_revision(),
        None,
        "bytes that were never read have no revision"
    );
    let codes = diagnostic_codes(&scanned);
    assert!(
        codes.contains(&DiagnosticCode::StateUnreadable),
        "{codes:?}"
    );
}

#[cfg(unix)]
#[test]
fn an_order_file_that_is_a_symbolic_link_is_refused() {
    let dir = vault();
    dir.write("elsewhere.json", r#"{"version":1,"children":[]}"#);
    std::os::unix::fs::symlink(
        dir.path().join("elsewhere.json"),
        dir.path().join(STATE_FILE_NAME),
    )
    .expect("symlink");

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(
        scanned.folder().state_access(),
        StateAccess::ReadOnly,
        "a link is never read through, and never written through"
    );
    assert_eq!(scanned.folder().state_revision(), None);
    let codes = diagnostic_codes(&scanned);
    assert!(
        codes.contains(&DiagnosticCode::StateUnreadable),
        "{codes:?}"
    );
}

#[test]
fn an_identity_two_entries_claim_is_placed_by_neither() {
    let dir = TempDir::new("state-duplicate");
    dir.write(".bbb-folder.md", folder_source("r00tr00t", None));
    dir.write(
        "One--aaaaaaaa.md",
        bookmark_source("aaaaaaaa", "https://one.example", "One"),
    );
    dir.write(
        "Two--aaaaaaaa.md",
        bookmark_source("aaaaaaaa", "https://two.example", "Two"),
    );
    dir.write(
        "Keep--bbbbbbbb.md",
        bookmark_source("bbbbbbbb", "https://keep.example", "Keep"),
    );
    dir.write(
        STATE_FILE_NAME,
        state(&[
            ("aaaaaaaa", ChildKind::Bookmark),
            ("bbbbbbbb", ChildKind::Bookmark),
        ]),
    );

    let scanned = scan(dir.path()).expect("scan");
    let paths: Vec<&str> = scanned
        .folder()
        .children()
        .iter()
        .map(ChildNode::relative_path)
        .collect();
    assert_eq!(
        paths,
        ["Keep--bbbbbbbb.md", "One--aaaaaaaa.md", "Two--aaaaaaaa.md"],
        "the ambiguous identity places neither copy; both fall to the appended \
         group in migration order"
    );
    assert!(diagnostic_codes(&scanned).contains(&DiagnosticCode::DuplicateId));
}

#[test]
fn bookmarks_without_a_recorded_order_sort_by_creation_then_identity() {
    let dir = TempDir::new("state-migration");
    dir.write(".bbb-folder.md", folder_source("r00tr00t", None));
    // Deliberately: the newest is alphabetically first, and the one with a
    // broken timestamp sorts last however it is spelled.
    for (id, title, created) in [
        ("zzzzzzzz", "Zulu", "2026-01-01T00:00:00Z"),
        ("aaaaaaaa", "Alpha", "2026-06-01T00:00:00Z"),
        ("mmmmmmmm", "Mike", "2026-03-01T00:00:00Z"),
    ] {
        dir.write(
            &format!("{title}--{id}.md"),
            format!(
                "---\nbbb_id: {id}\nbbb_url: https://x.example\nbbb_title: {title}\n\
                 bbb_created: {created}\nbbb_updated: {created}\n---\n"
            ),
        );
    }
    dir.write(
        "Broken--qqqqqqqq.md",
        "---\nbbb_id: qqqqqqqq\nbbb_url: https://q.example\nbbb_title: Broken\n\
         bbb_created: yesterday\nbbb_updated: yesterday\n---\n",
    );

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(
        child_ids(&scanned),
        ["zzzzzzzz", "mmmmmmmm", "aaaaaaaa", "qqqqqqqq"],
        "oldest first, and an unusable timestamp falls to the end by identity"
    );
}

#[test]
fn a_nested_folder_keeps_its_own_order() {
    let dir = TempDir::new("state-nested");
    dir.write(".bbb-folder.md", folder_source("r00tr00t", None));
    dir.write("Dev/.bbb-folder.md", folder_source("dddddddd", Some("Dev")));
    dir.write(
        "Dev/One--11111111.md",
        bookmark_source("11111111", "https://one.example", "One"),
    );
    dir.write(
        "Dev/Two--22222222.md",
        bookmark_source("22222222", "https://two.example", "Two"),
    );
    dir.write(
        &format!("Dev/{STATE_FILE_NAME}"),
        state(&[
            ("22222222", ChildKind::Bookmark),
            ("11111111", ChildKind::Bookmark),
        ]),
    );

    let scanned = scan(dir.path()).expect("scan");
    let dev = scanned.folder().folders().next().expect("Dev");
    let ids: Vec<String> = dev
        .children()
        .iter()
        .map(|child| child.id().expect("an id").to_string())
        .collect();
    assert_eq!(ids, ["22222222", "11111111"]);
    assert!(dev.state_revision().is_some());
    assert_eq!(
        scanned.folder().state_access(),
        StateAccess::Absent,
        "a nested order file says nothing about its parent"
    );
}

#[test]
fn the_order_file_is_not_shown_as_a_bookmark_or_reported_as_a_stray() {
    let dir = vault();
    dir.write(STATE_FILE_NAME, state(&[("aaaaaaaa", ChildKind::Bookmark)]));

    let scanned = scan(dir.path()).expect("scan");
    assert_eq!(scanned.folder().children().len(), 4);
    assert!(
        !scanned
            .diagnostics()
            .iter()
            .any(|diagnostic| diagnostic.path() == Some(STATE_FILE_NAME)),
        "the daemon's own bookkeeping is not a problem to report"
    );
}

#[test]
fn scanning_the_same_recorded_order_twice_gives_the_same_answer() {
    let dir = vault();
    dir.write(
        STATE_FILE_NAME,
        state(&[
            ("eeeeeeee", ChildKind::Folder),
            ("bbbbbbbb", ChildKind::Bookmark),
        ]),
    );

    let first = scan(dir.path()).expect("scan");
    let second = scan(dir.path()).expect("scan");
    assert_eq!(child_ids(&first), child_ids(&second));
    assert_eq!(
        first.folder().state_revision(),
        second.folder().state_revision()
    );
}
