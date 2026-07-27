//! Golden-fixture tests for parsing and updating managed documents.
//!
//! Every fixture under `tests/fixtures/documents` is a real file with real
//! bytes: CRLF, byte order marks, comments, unknown keys, quoting styles and
//! invalid UTF-8 are all committed exactly as a user's editor would leave them.

mod support;

use bbb_vault_core::{
    Access, BookmarkFile, BookmarkUpdate, Diagnostic, DiagnosticCode, FolderFile, FolderUpdate, Id,
    ParseError, Revision, Severity, UpdateError,
};

use support::{assert_golden, read_fixture};

/// Every valid bookmark fixture, with the facts a reader should be able to
/// recover from it.
struct Expected {
    fixture: &'static str,
    id: &'static str,
    url: &'static str,
    title: Option<&'static str>,
    created: Option<&'static str>,
    updated: Option<&'static str>,
    logo: Option<&'static str>,
    bom: bool,
    crlf: bool,
}

const VALID: &[Expected] = &[
    Expected {
        fixture: "documents/simple-lf.md",
        id: "a1b2c3d4",
        url: "https://example.com/react",
        title: Some("React"),
        created: Some("2026-01-01T09:00:00Z"),
        updated: Some("2026-01-02T10:30:00Z"),
        logo: None,
        bom: false,
        crlf: false,
    },
    Expected {
        fixture: "documents/crlf-unknown-keys.md",
        id: "b2c3d4e5",
        url: "https://react.dev",
        title: Some("React documentation"),
        created: Some("2026-02-03T08:15:00+01:00"),
        updated: Some("2026-02-03T08:15:00+01:00"),
        logo: None,
        bom: false,
        crlf: true,
    },
    Expected {
        fixture: "documents/bom-crlf.md",
        id: "c3d4e5f6",
        url: "https://example.org",
        title: Some("Example"),
        created: Some("2026-03-04T00:00:00Z"),
        updated: Some("2026-03-04T00:00:00Z"),
        logo: None,
        bom: true,
        crlf: true,
    },
    Expected {
        fixture: "documents/comments-and-blocks.md",
        id: "d4e5f6a7",
        url: "https://example.com/a,b(c)",
        title: Some("Commented"),
        created: Some("2026-04-05T12:00:00Z"),
        updated: Some("2026-04-05T12:00:00Z"),
        logo: None,
        bom: false,
        crlf: false,
    },
    Expected {
        fixture: "documents/unicode.md",
        id: "e5f6a7b8",
        url: "https://ja.wikipedia.org/wiki/日本語",
        title: Some("日本語 — ドキュメント ☕"),
        created: Some("2026-05-06T23:59:60Z"),
        updated: Some("2026-05-06T23:59:60Z"),
        logo: None,
        bom: false,
        crlf: false,
    },
    Expected {
        fixture: "documents/quoted-styles.md",
        id: "f6a7b8c9",
        url: "https://example.com/it's",
        title: Some("A \"quoted\" title"),
        created: Some("2026-06-07T06:07:08Z"),
        updated: Some("2026-06-07T06:07:08Z"),
        logo: None,
        bom: false,
        crlf: false,
    },
    Expected {
        fixture: "documents/with-logo.md",
        id: "0a1b2c3d",
        url: "https://example.com",
        title: Some("Has a logo"),
        created: Some("2026-07-08T00:00:00Z"),
        updated: Some("2026-07-08T00:00:00Z"),
        logo: Some("Has a logo--0a1b2c3d.assets/logo.svg"),
        bom: false,
        crlf: false,
    },
    Expected {
        fixture: "documents/empty-optional.md",
        id: "1a2b3c4d",
        url: "https://example.com/empty",
        title: Some("Empty optional"),
        created: Some("2026-07-09T00:00:00Z"),
        updated: Some("2026-07-09T00:00:00Z"),
        logo: None,
        bom: false,
        crlf: false,
    },
    Expected {
        fixture: "documents/numeric-title.md",
        id: "2a3b4c5d",
        url: "https://example.com/2026",
        title: Some("2026"),
        created: Some("2026-07-10T00:00:00Z"),
        updated: Some("2026-07-10T00:00:00Z"),
        logo: None,
        bom: false,
        crlf: false,
    },
];

fn parse(fixture: &str) -> (Vec<u8>, BookmarkFile) {
    let bytes = read_fixture(fixture);
    let file =
        BookmarkFile::parse(&bytes).unwrap_or_else(|error| panic!("parsing {fixture}: {error}"));
    (bytes, file)
}

#[test]
fn reads_every_owned_field_from_every_valid_fixture() {
    for case in VALID {
        let (_, file) = parse(case.fixture);
        assert_eq!(file.id(), Id::parse(case.id).unwrap(), "{}", case.fixture);
        assert_eq!(file.url(), Some(case.url), "{}", case.fixture);
        assert_eq!(file.title(), case.title, "{}", case.fixture);
        assert_eq!(file.created(), case.created, "{}", case.fixture);
        assert_eq!(file.updated(), case.updated, "{}", case.fixture);
        assert_eq!(file.logo(), case.logo, "{}", case.fixture);
        assert_eq!(file.has_bom(), case.bom, "{}", case.fixture);
        assert_eq!(file.is_crlf(), case.crlf, "{}", case.fixture);
        assert_eq!(file.access(), Access::ReadWrite, "{}", case.fixture);
        assert!(
            file.diagnostics()
                .iter()
                .all(|diagnostic| diagnostic.severity() == Severity::Warning),
            "{} reported an error-level diagnostic",
            case.fixture
        );
    }
}

#[test]
fn writing_a_field_its_current_value_is_a_no_op() {
    for case in VALID {
        let (bytes, file) = parse(case.fixture);
        let mut update = BookmarkUpdate::new().url(case.url);
        if let Some(title) = case.title {
            update = update.title(title);
        }
        if let Some(created) = case.created {
            update = update.created(created);
        }
        if let Some(updated) = case.updated {
            update = update.updated(updated);
        }
        if let Some(logo) = case.logo {
            update = update.logo(logo);
        }

        let written = file.apply(&bytes, &update).expect("a no-op update");
        assert_eq!(written, bytes, "{} was not byte-identical", case.fixture);
    }
}

#[test]
fn an_empty_update_is_a_no_op() {
    for case in VALID {
        let (bytes, file) = parse(case.fixture);
        let written = file
            .apply(&bytes, &BookmarkUpdate::new())
            .expect("an empty update");
        assert_eq!(written, bytes, "{}", case.fixture);
    }
}

#[test]
fn a_title_change_touches_exactly_one_line() {
    for case in VALID {
        let (bytes, file) = parse(case.fixture);
        let written = file
            .apply(&bytes, &BookmarkUpdate::new().title("Brand new title"))
            .expect("a title update");

        let before = String::from_utf8(bytes).expect("valid UTF-8");
        let after = String::from_utf8(written.clone()).expect("valid UTF-8");
        let changed: Vec<_> = before
            .split_inclusive('\n')
            .zip(after.split_inclusive('\n'))
            .filter(|(left, right)| left != right)
            .collect();
        assert_eq!(
            changed.len(),
            1,
            "{} changed {} lines: {changed:?}",
            case.fixture,
            changed.len()
        );
        assert!(
            changed[0].1.contains("bbb_title"),
            "{} changed the wrong line: {:?}",
            case.fixture,
            changed[0]
        );
        assert_eq!(
            before.lines().count(),
            after.lines().count(),
            "{}",
            case.fixture
        );

        let reparsed = BookmarkFile::parse(&written).expect("the result is still valid");
        assert_eq!(reparsed.title(), Some("Brand new title"));
        assert_eq!(reparsed.id(), file.id(), "identity must not move");
        assert_eq!(reparsed.url(), file.url());
        assert_eq!(reparsed.created(), file.created());
        assert_eq!(reparsed.has_bom(), file.has_bom());
        assert_eq!(reparsed.is_crlf(), file.is_crlf());
    }
}

/// The canonical multi-field update, captured byte for byte.
///
/// This is the strongest statement the format can make: unknown keys, comments,
/// block scalars, quoting styles, the byte order mark, line endings and the body
/// are all still there afterwards.
#[test]
fn canonical_update_matches_the_golden_output() {
    for case in VALID {
        let (bytes, file) = parse(case.fixture);
        let written = file
            .apply(
                &bytes,
                &BookmarkUpdate::new()
                    .title("Renamed ✎")
                    .updated("2026-12-31T23:59:59Z")
                    .logo("assets/logo.png"),
            )
            .expect("the canonical update");

        let name = case
            .fixture
            .strip_prefix("documents/")
            .expect("a document fixture");
        assert_golden(
            &format!("documents/expected/{name}"),
            &String::from_utf8(written).expect("valid UTF-8"),
        );
    }
}

#[test]
fn quoting_style_is_preserved_and_upgraded_only_when_needed() {
    let (bytes, file) = parse("documents/quoted-styles.md");
    let written = file
        .apply(
            &bytes,
            &BookmarkUpdate::new()
                .url("https://example.com/plain")
                .title("still double quoted"),
        )
        .expect("an update");
    let text = String::from_utf8(written).expect("valid UTF-8");

    // A single-quoted field stays single-quoted, a double-quoted one stays
    // double-quoted, even when the new value would be safe unquoted.
    assert!(
        text.contains("bbb_url: 'https://example.com/plain'"),
        "{text}"
    );
    assert!(
        text.contains("bbb_title: \"still double quoted\""),
        "{text}"
    );
}

#[test]
fn a_plain_field_is_quoted_when_the_new_value_needs_it() {
    let (bytes, file) = parse("documents/simple-lf.md");
    let written = file
        .apply(&bytes, &BookmarkUpdate::new().title("true"))
        .expect("an update");
    let text = String::from_utf8(written).expect("valid UTF-8");
    assert!(text.contains("bbb_title: \"true\""), "{text}");

    let reparsed = BookmarkFile::parse(text.as_bytes()).expect("still valid");
    assert_eq!(reparsed.title(), Some("true"));
}

#[test]
fn an_absent_optional_key_is_inserted_next_to_the_owned_keys() {
    let (bytes, file) = parse("documents/simple-lf.md");
    assert_eq!(file.logo(), None);

    let written = file
        .apply(
            &bytes,
            &BookmarkUpdate::new().logo("React--a1b2c3d4.assets/logo.png"),
        )
        .expect("inserting a logo");
    let text = String::from_utf8(written).expect("valid UTF-8");
    assert!(
        text.contains(
            "bbb_updated: 2026-01-02T10:30:00Z\nbbb_logo: React--a1b2c3d4.assets/logo.png\n---"
        ),
        "{text}"
    );

    let reparsed = BookmarkFile::parse(text.as_bytes()).expect("still valid");
    assert_eq!(reparsed.logo(), Some("React--a1b2c3d4.assets/logo.png"));
}

#[test]
fn an_empty_optional_key_is_filled_in_place_and_keeps_its_comment() {
    let (bytes, file) = parse("documents/empty-optional.md");
    assert_eq!(file.logo(), None);

    let written = file
        .apply(&bytes, &BookmarkUpdate::new().logo("logo.png"))
        .expect("filling a logo");
    let text = String::from_utf8(written).expect("valid UTF-8");
    assert!(
        text.contains("bbb_logo: logo.png # filled in later\n"),
        "{text}"
    );
    // The body still has no trailing newline.
    assert!(
        text.ends_with("No trailing newline after this line."),
        "{text}"
    );
}

#[test]
fn clearing_an_optional_key_removes_its_whole_line() {
    let (bytes, file) = parse("documents/with-logo.md");
    let written = file
        .apply(&bytes, &BookmarkUpdate::new().clear_logo())
        .expect("clearing the logo");
    let text = String::from_utf8(written).expect("valid UTF-8");
    assert!(!text.contains("bbb_logo"), "{text}");
    assert!(
        text.contains("bbb_title: Has a logo\nbbb_created:"),
        "{text}"
    );

    let reparsed = BookmarkFile::parse(text.as_bytes()).expect("still valid");
    assert_eq!(reparsed.logo(), None);
    assert_eq!(reparsed.id(), file.id());

    // Clearing a key that is already absent changes nothing.
    let cleared = reparsed
        .apply(text.as_bytes(), &BookmarkUpdate::new().clear_logo())
        .expect("a second clear");
    assert_eq!(cleared, text.as_bytes());
}

#[test]
fn a_stale_source_is_rejected_instead_of_overwritten() {
    let (bytes, file) = parse("documents/simple-lf.md");
    let mut edited = bytes.clone();
    edited.extend_from_slice(b"\nAn external editor appended this.\n");

    let error = file
        .apply(&edited, &BookmarkUpdate::new().title("Nope"))
        .expect_err("a stale write must be refused");
    assert_eq!(
        error,
        UpdateError::StaleSource {
            expected: Revision::of(&bytes),
            actual: Revision::of(&edited),
        }
    );
}

#[test]
fn values_that_cannot_round_trip_are_refused() {
    let (bytes, file) = parse("documents/simple-lf.md");
    let cases = [
        (BookmarkUpdate::new().title("two\nlines"), "bbb_title"),
        (BookmarkUpdate::new().url("   "), "bbb_url"),
        (BookmarkUpdate::new().created("yesterday"), "bbb_created"),
        (
            BookmarkUpdate::new().updated("2026-13-01T00:00:00Z"),
            "bbb_updated",
        ),
        (BookmarkUpdate::new().logo(""), "bbb_logo"),
    ];
    for (update, key) in cases {
        match file.apply(&bytes, &update) {
            Err(UpdateError::InvalidValue { key: actual, .. }) => assert_eq!(actual, key),
            other => panic!("expected {key} to be refused, got {other:?}"),
        }
    }
}

#[test]
fn malformed_documents_are_rejected_with_an_actionable_diagnostic() {
    let cases: &[(&str, DiagnosticCode, Option<usize>)] = &[
        (
            "documents/invalid/unterminated.md",
            DiagnosticCode::UnterminatedFrontmatter,
            None,
        ),
        (
            "documents/invalid/duplicate-owned-key.md",
            DiagnosticCode::DuplicateOwnedKey,
            Some(4),
        ),
        (
            "documents/invalid/sequence-root.md",
            DiagnosticCode::NonMappingRoot,
            Some(2),
        ),
        (
            "documents/invalid/scalar-root.md",
            DiagnosticCode::NonMappingRoot,
            Some(2),
        ),
        (
            "documents/invalid/block-scalar-title.md",
            DiagnosticCode::UnsupportedValue,
            Some(4),
        ),
        (
            "documents/invalid/flow-collection-url.md",
            DiagnosticCode::UnsupportedValue,
            Some(3),
        ),
        (
            "documents/invalid/nested-title.md",
            DiagnosticCode::UnsupportedValue,
            Some(4),
        ),
        // Unknown YAML the byte scanner never interprets, but that no other
        // reader can parse either.
        (
            "documents/invalid/malformed-collection.md",
            DiagnosticCode::MalformedYaml,
            Some(8),
        ),
        (
            "documents/invalid/degraded.md",
            DiagnosticCode::DuplicateKey,
            Some(7),
        ),
        (
            "documents/invalid/bad-id.md",
            DiagnosticCode::InvalidId,
            Some(2),
        ),
        (
            "documents/invalid/invalid-utf8.md",
            DiagnosticCode::InvalidUtf8,
            None,
        ),
    ];

    for (fixture, code, line) in cases {
        let bytes = read_fixture(fixture);
        let error = BookmarkFile::parse(&bytes).expect_err(fixture);
        assert_eq!(error.code(), *code, "{fixture}");
        assert_eq!(error.line(), *line, "{fixture}");

        let diagnostic = error.to_diagnostic(*fixture);
        assert_eq!(diagnostic.severity(), Severity::Error, "{fixture}");
        assert_eq!(diagnostic.path(), Some(*fixture));
        assert!(!diagnostic.detail().is_empty(), "{fixture}");
    }
}

#[test]
fn ordinary_markdown_is_not_a_bookmark() {
    for fixture in [
        "documents/invalid/no-frontmatter.md",
        "documents/invalid/plain-note.md",
    ] {
        let bytes = read_fixture(fixture);
        assert!(
            matches!(
                BookmarkFile::parse(&bytes),
                Err(ParseError::NotManaged | ParseError::MissingFrontmatter)
            ),
            "{fixture}"
        );
    }
}

#[test]
fn a_degraded_document_stays_writable_and_explains_itself() {
    let bytes = read_fixture("documents/degraded-writable.md");
    let file = BookmarkFile::parse(&bytes).expect("degraded but parsable");
    assert_eq!(file.access(), Access::ReadWrite);
    assert_eq!(file.title(), None);
    assert_eq!(file.created(), Some("yesterday"));
    assert_eq!(file.updated(), None);

    let mut codes: Vec<_> = file.diagnostics().iter().map(Diagnostic::code).collect();
    codes.sort_unstable();
    codes.dedup();
    assert_eq!(
        codes,
        [
            DiagnosticCode::MissingRequiredField,
            DiagnosticCode::InvalidTimestamp,
            DiagnosticCode::ReservedKeyUnknown,
        ]
    );

    // The missing fields are inserted rather than the document being rebuilt.
    let written = file
        .apply(
            &bytes,
            &BookmarkUpdate::new()
                .title("Repaired")
                .created("2026-01-01T00:00:00Z")
                .updated("2026-01-02T00:00:00Z"),
        )
        .expect("repairing the document");
    let repaired = BookmarkFile::parse(&written).expect("still valid");
    assert_eq!(repaired.title(), Some("Repaired"));
    assert_eq!(repaired.created(), Some("2026-01-01T00:00:00Z"));
    assert_eq!(repaired.updated(), Some("2026-01-02T00:00:00Z"));
    assert!(String::from_utf8_lossy(&written).contains("bbb_extra: reserved but unknown"));
}

/// Unknown front matter is user data the vault preserves, but only when it is
/// front matter at all. A block that no conformant YAML reader accepts, or that
/// answers a key two different ways, cannot be written to safely.
#[test]
fn ambiguous_or_unparsable_unknown_yaml_makes_a_document_read_only() {
    let cases: &[(&str, DiagnosticCode)] = &[
        // A duplicated *unknown* key: readers disagree about which value wins.
        (
            "documents/invalid/degraded.md",
            DiagnosticCode::DuplicateKey,
        ),
        // An unterminated flow sequence under a key the vault never touches.
        (
            "documents/invalid/malformed-collection.md",
            DiagnosticCode::MalformedYaml,
        ),
    ];
    for (fixture, code) in cases {
        let bytes = read_fixture(fixture);
        let error = BookmarkFile::parse(&bytes).expect_err(fixture);
        assert_eq!(error.code(), *code, "{fixture}");
        assert_eq!(
            error.to_diagnostic(*fixture).severity(),
            Severity::Error,
            "{fixture}"
        );
        assert!(error.line().is_some(), "{fixture} must name a line");
    }
}

/// The same strictness, stated directly against the byte scanner's blind spots.
///
/// Each of these uses a construct the byte scanner records as opaque bytes and
/// never interprets. Only the conformant parser can tell the harmless ones from
/// the ones no reader could agree on.
#[test]
fn unknown_keys_are_preserved_only_when_they_are_valid_yaml() {
    let head = "---\nbbb_id: a1b2c3d4\nbbb_url: https://example.com\nbbb_title: Fine\n\
                bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n";

    // Valid but exotic unknown values stay untouched and the document is usable.
    let usable = format!("{head}anchors: &a [1, 2]\nalias: *a\nblock: |\n  text\n---\n");
    let file = BookmarkFile::parse(usable.as_bytes()).expect("valid YAML");
    assert_eq!(file.access(), Access::ReadWrite);
    // …and a write still leaves every one of those bytes alone.
    let written = file
        .apply(usable.as_bytes(), &BookmarkUpdate::new().title("Renamed"))
        .expect("writable");
    let text = String::from_utf8(written).expect("valid UTF-8");
    assert!(
        text.contains("anchors: &a [1, 2]\nalias: *a\nblock: |\n  text\n"),
        "{text}"
    );

    let broken: &[(&str, DiagnosticCode)] = &[
        // A dangling alias: syntactically fine to the byte scanner, rejected by
        // any real reader.
        ("alias: *nowhere\n", DiagnosticCode::MalformedYaml),
        // A flow mapping that is never closed.
        ("map: {a: 1\n", DiagnosticCode::MalformedYaml),
        // An unterminated flow sequence.
        ("tags: [a, b\n", DiagnosticCode::MalformedYaml),
        // A duplicate nested under an unknown key is just as ambiguous as one
        // at the top level.
        ("outer:\n  k: 1\n  k: 2\n", DiagnosticCode::DuplicateKey),
        // A duplicated unknown key at the top level.
        ("tags: one\ntags: two\n", DiagnosticCode::DuplicateKey),
    ];
    for (tail, code) in broken {
        let source = format!("{head}{tail}---\n");
        match BookmarkFile::parse(source.as_bytes()) {
            Err(error) => assert_eq!(error.code(), *code, "{tail:?}"),
            Ok(_) => panic!("{tail:?} should have been refused"),
        }
    }
}

#[test]
fn a_read_only_document_cannot_be_written() {
    // `bbb_url` is empty, which is an error-level diagnostic.
    let source = b"---\nbbb_id: a1b2c3d4\nbbb_url:\nbbb_title: No URL\n\
                   bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\n";
    let file = BookmarkFile::parse(source).expect("parsable");
    assert_eq!(file.access(), Access::ReadOnly);
    assert_eq!(
        file.apply(source, &BookmarkUpdate::new().title("Nope")),
        Err(UpdateError::ReadOnly)
    );
}

#[test]
fn folder_metadata_round_trips() {
    let bytes = read_fixture("documents/folders/folder-minimal.md");
    let folder = FolderFile::parse(&bytes).expect("parsable");
    assert_eq!(folder.id(), Id::parse("3a4b5c6d").unwrap());
    assert_eq!(folder.title(), None);
    assert_eq!(folder.access(), Access::ReadWrite);

    let written = folder
        .apply(&bytes, &FolderUpdate::new().title("Inbox"))
        .expect("adding a title");
    assert_eq!(
        String::from_utf8(written.clone()).unwrap(),
        "---\nbbb_id: 3a4b5c6d\nbbb_title: Inbox\n---\n"
    );

    let retitled = FolderFile::parse(&written).expect("still valid");
    assert_eq!(retitled.title(), Some("Inbox"));
    assert_eq!(
        retitled
            .apply(&written, &FolderUpdate::new().title("Inbox"))
            .unwrap(),
        written,
        "a no-op folder update is byte-identical"
    );
}

#[test]
fn folder_metadata_preserves_unknown_keys_and_crlf() {
    let bytes = read_fixture("documents/folders/folder-titled.md");
    let folder = FolderFile::parse(&bytes).expect("parsable");
    assert_eq!(folder.id(), Id::parse("4a5b6c7d").unwrap());
    assert_eq!(folder.title(), Some("Reading List"));
    assert!(folder.is_crlf());

    let written = folder
        .apply(&bytes, &FolderUpdate::new().title("Books"))
        .expect("renaming");
    let text = String::from_utf8(written).expect("valid UTF-8");
    assert!(text.contains("bbb_title: Books\r\n"), "{text}");
    assert!(text.contains("icon: 📚\r\n"), "{text}");
    assert!(text.ends_with("Notes about this folder.\r\n"), "{text}");
}

#[test]
fn folder_metadata_without_an_identity_is_an_error() {
    let error = FolderFile::parse(b"---\nbbb_title: No identity\n---\n").expect_err("no identity");
    assert_eq!(error.code(), DiagnosticCode::InvalidId);
}

#[test]
fn rendered_documents_are_parsable_and_canonical() {
    let id = Id::parse("a1b2c3d4").unwrap();
    let rendered = bbb_vault_core::render_bookmark(
        id,
        "https://example.com",
        "New bookmark",
        "2026-01-01T00:00:00Z",
        "2026-01-01T00:00:00Z",
    )
    .expect("renderable");
    assert_eq!(
        rendered,
        "---\nbbb_id: a1b2c3d4\nbbb_url: https://example.com\nbbb_title: New bookmark\n\
         bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\n"
    );

    let file = BookmarkFile::parse(rendered.as_bytes()).expect("parsable");
    assert_eq!(file.access(), Access::ReadWrite);
    assert!(file.diagnostics().is_empty());

    assert_eq!(
        bbb_vault_core::render_folder(id, Some("Inbox")).unwrap(),
        "---\nbbb_id: a1b2c3d4\nbbb_title: Inbox\n---\n"
    );
    assert_eq!(
        bbb_vault_core::render_folder(id, None).unwrap(),
        "---\nbbb_id: a1b2c3d4\n---\n"
    );
}
