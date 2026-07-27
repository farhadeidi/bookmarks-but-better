//! Portable filename sanitization and collision resolution.
//!
//! Vault paths have to survive being copied between Linux, macOS and Windows,
//! synchronized by third-party tools, and typed by hand. The rules here are the
//! intersection of what those platforms accept, applied uniformly so the same
//! title always produces the same name.

use std::collections::HashSet;

use crate::id::Id;

/// Maximum size, in bytes, of the human-readable part of a vault name.
///
/// Filesystems commonly cap a single path component at 255 bytes. Keeping the
/// readable stem well under that leaves room for the `--<id>.md` suffix, for a
/// `.assets` sibling directory and for a `-<n>` collision suffix.
pub const MAX_STEM_BYTES: usize = 96;

/// The name used when a title sanitizes to nothing at all.
const FALLBACK_STEM: &str = "untitled";

/// Device names that Windows refuses to use for a file or directory,
/// case-insensitively and regardless of extension.
const RESERVED_STEMS: [&str; 22] = [
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

/// Characters that are illegal in a Windows path component.
const FORBIDDEN: [char; 9] = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];

/// Invisible direction and formatting controls, removed because they let a
/// filename render as something other than what it is.
const INVISIBLE: [char; 11] = [
    '\u{200e}', '\u{200f}', '\u{202a}', '\u{202b}', '\u{202c}', '\u{202d}', '\u{202e}', '\u{2066}',
    '\u{2067}', '\u{2068}', '\u{2069}',
];

/// Reduces a display title to a portable, human-readable path component.
///
/// Forbidden and invisible characters become `-`, runs of whitespace become a
/// single space, leading and trailing separators and dots are removed, and the
/// result is truncated to [`MAX_STEM_BYTES`] on a character boundary. A title
/// that sanitizes to nothing yields `untitled`.
///
/// The result is *not* case-folded and non-ASCII characters are preserved:
/// vault names stay readable in the user's own language.
#[must_use]
pub fn sanitize_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut pending_separator = false;
    let mut pending_is_dash = false;

    for character in title.chars() {
        if character == '\u{feff}' || INVISIBLE.contains(&character) {
            pending_separator = true;
            pending_is_dash = true;
            continue;
        }
        if character.is_whitespace() {
            pending_separator = true;
            continue;
        }
        if character.is_control() || FORBIDDEN.contains(&character) {
            pending_separator = true;
            pending_is_dash = true;
            continue;
        }
        if pending_separator && !out.is_empty() {
            out.push(if pending_is_dash { '-' } else { ' ' });
        }
        pending_separator = false;
        pending_is_dash = false;
        out.push(character);
    }

    let trimmed = trim_edges(&out);
    let truncated = truncate_bytes(trimmed, MAX_STEM_BYTES);
    let trimmed = trim_edges(truncated);
    if trimmed.is_empty() {
        FALLBACK_STEM.to_owned()
    } else {
        trimmed.to_owned()
    }
}

/// Returns `true` when `stem` would name a Windows device.
///
/// The check is case-insensitive and ignores any extension, matching the way
/// Windows itself resolves `nul`, `NUL.txt` and `Nul.tar.gz` to the same device.
#[must_use]
pub fn is_reserved_stem(stem: &str) -> bool {
    let head = stem.split('.').next().unwrap_or(stem);
    RESERVED_STEMS
        .iter()
        .any(|reserved| head.eq_ignore_ascii_case(reserved))
}

/// Builds the directory name for a bookmark folder.
///
/// Unlike a bookmark file, a directory carries no identity suffix, so a title
/// that sanitizes to a Windows device name is escaped with a leading `_`.
#[must_use]
pub fn folder_directory_name(title: &str) -> String {
    let base = sanitize_title(title);
    escape_reserved(&base)
}

/// Builds the filename for a bookmark.
///
/// The name is `<sanitized title>--<id>.md`; the suffix is immutable and the
/// readable part may change whenever the title does.
#[must_use]
pub fn bookmark_file_name(title: &str, id: Id) -> String {
    format!("{}--{}.md", sanitize_title(title), id)
}

/// Builds the sibling directory that holds a bookmark's local assets.
///
/// `React--a1b2c3d4.md` keeps its assets in `React--a1b2c3d4.assets/`.
#[must_use]
pub fn assets_directory_name(bookmark_file_name: &str) -> String {
    let stem = strip_markdown_extension(bookmark_file_name).unwrap_or(bookmark_file_name);
    format!("{stem}.assets")
}

/// Splits a bookmark filename into its readable part and its identity.
///
/// Returns `None` when the name is not `<something>--<id>.md`.
#[must_use]
pub fn parse_bookmark_file_name(name: &str) -> Option<(&str, Id)> {
    let stem = strip_markdown_extension(name)?;
    let (base, id) = stem.rsplit_once("--")?;
    Some((base, Id::parse(id).ok()?))
}

/// Returns the key used to compare two names for equality.
///
/// macOS and Windows treat `React` and `react` as the same name, so the vault
/// treats them that way everywhere rather than only on those platforms.
///
/// The fold is Unicode-aware simple lowercasing. It does not normalize
/// composition, so `é` and `é` remain distinct; that difference is reported as
/// an ordinary collision if it ever reaches the filesystem.
#[must_use]
pub fn fold_key(name: &str) -> String {
    name.to_lowercase()
}

/// Hands out path components that do not collide with each other.
///
/// Collisions are resolved by appending ` -2`, `-3`, … to the readable part, so
/// the identity suffix of a bookmark file is never disturbed.
#[derive(Debug, Clone, Default)]
pub struct NameAllocator {
    taken: HashSet<String>,
}

impl NameAllocator {
    /// Creates an empty allocator.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Creates an allocator that already considers `names` to be in use.
    pub fn from_existing<I, S>(names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let mut allocator = Self::new();
        for name in names {
            allocator.reserve(name.as_ref());
        }
        allocator
    }

    /// Returns `true` when `name` is already in use, case-insensitively.
    #[must_use]
    pub fn contains(&self, name: &str) -> bool {
        self.taken.contains(&fold_key(name))
    }

    /// Marks `name` as in use, returning `false` when it already was.
    pub fn reserve(&mut self, name: &str) -> bool {
        self.taken.insert(fold_key(name))
    }

    /// Allocates a free directory name for a folder titled `title`.
    pub fn allocate_folder(&mut self, title: &str) -> String {
        self.allocate(&folder_directory_name(title), str::to_owned)
    }

    /// Allocates a free filename for a bookmark titled `title` with identity `id`.
    pub fn allocate_bookmark(&mut self, title: &str, id: Id) -> String {
        self.allocate(&sanitize_title(title), move |base| {
            format!("{base}--{id}.md")
        })
    }

    fn allocate(&mut self, base: &str, build: impl Fn(&str) -> String) -> String {
        let mut candidate = build(base);
        let mut counter: u32 = 2;
        while !self.reserve(&candidate) {
            let suffix = format!("-{counter}");
            let room = MAX_STEM_BYTES.saturating_sub(suffix.len());
            let head = trim_edges(truncate_bytes(base, room));
            let head = if head.is_empty() { FALLBACK_STEM } else { head };
            candidate = build(&format!("{head}{suffix}"));
            counter += 1;
        }
        candidate
    }
}

fn escape_reserved(base: &str) -> String {
    if is_reserved_stem(base) {
        format!("_{base}")
    } else {
        base.to_owned()
    }
}

fn strip_markdown_extension(name: &str) -> Option<&str> {
    let split = name.len().checked_sub(3)?;
    let (stem, extension) = name.split_at(split);
    (extension.eq_ignore_ascii_case(".md") && !stem.is_empty()).then_some(stem)
}

fn trim_edges(text: &str) -> &str {
    text.trim_matches(|character: char| matches!(character, '.' | '-' | ' '))
}

fn truncate_bytes(text: &str, limit: usize) -> &str {
    if text.len() <= limit {
        return text;
    }
    let mut end = limit;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_STEM_BYTES, NameAllocator, assets_directory_name, bookmark_file_name, fold_key,
        folder_directory_name, is_reserved_stem, parse_bookmark_file_name, sanitize_title,
    };
    use crate::id::Id;

    fn id(text: &str) -> Id {
        Id::parse(text).expect("valid test id")
    }

    #[test]
    fn keeps_ordinary_titles_readable() {
        assert_eq!(sanitize_title("React"), "React");
        assert_eq!(sanitize_title("Rust by Example"), "Rust by Example");
        assert_eq!(sanitize_title("C++ 20 features"), "C++ 20 features");
    }

    #[test]
    fn replaces_forbidden_characters() {
        assert_eq!(sanitize_title("a/b\\c"), "a-b-c");
        assert_eq!(sanitize_title("Q: what?"), "Q-what");
        assert_eq!(sanitize_title("<script>"), "script");
        assert_eq!(sanitize_title("tab\tseparated"), "tab separated");
        assert_eq!(sanitize_title("null\u{0}byte"), "null-byte");
    }

    #[test]
    fn collapses_and_trims_separators() {
        assert_eq!(sanitize_title("   spaced   out   "), "spaced out");
        assert_eq!(sanitize_title("...dotted..."), "dotted");
        assert_eq!(sanitize_title("--dashes--"), "dashes");
        assert_eq!(sanitize_title("a // b"), "a-b");
    }

    #[test]
    fn strips_invisible_direction_marks() {
        assert_eq!(sanitize_title("evil\u{202e}gnp.exe"), "evil-gnp.exe");
        assert_eq!(sanitize_title("\u{feff}Title"), "Title");
    }

    #[test]
    fn falls_back_when_nothing_survives() {
        assert_eq!(sanitize_title(""), "untitled");
        assert_eq!(sanitize_title("///"), "untitled");
        assert_eq!(sanitize_title("   "), "untitled");
        assert_eq!(sanitize_title("."), "untitled");
        assert_eq!(sanitize_title(".."), "untitled");
    }

    #[test]
    fn preserves_unicode() {
        assert_eq!(sanitize_title("Café ☕ 日本語"), "Café ☕ 日本語");
        assert_eq!(sanitize_title("Проект"), "Проект");
        assert_eq!(sanitize_title("مرحبا"), "مرحبا");
    }

    #[test]
    fn truncates_on_a_character_boundary() {
        let long = "é".repeat(200);
        let sanitized = sanitize_title(&long);
        assert!(sanitized.len() <= MAX_STEM_BYTES);
        assert_eq!(sanitized.chars().count(), MAX_STEM_BYTES / 2);
        assert!(sanitized.chars().all(|character| character == 'é'));
    }

    #[test]
    fn escapes_windows_device_names_for_directories() {
        assert!(is_reserved_stem("CON"));
        assert!(is_reserved_stem("nul.txt"));
        assert!(is_reserved_stem("LpT9.tar.gz"));
        assert!(!is_reserved_stem("console"));
        assert!(!is_reserved_stem("com10"));

        assert_eq!(folder_directory_name("con"), "_con");
        assert_eq!(folder_directory_name("PRN"), "_PRN");
        assert_eq!(folder_directory_name("Nul.txt"), "_Nul.txt");
        assert_eq!(folder_directory_name("Console"), "Console");
    }

    #[test]
    fn bookmark_names_carry_the_identity_suffix() {
        assert_eq!(
            bookmark_file_name("React", id("a1b2c3d4")),
            "React--a1b2c3d4.md"
        );
        // A device name is harmless once the suffix is attached.
        assert_eq!(
            bookmark_file_name("con", id("a1b2c3d4")),
            "con--a1b2c3d4.md"
        );
    }

    #[test]
    fn bookmark_names_round_trip() {
        // A title may itself contain `--`; the *last* one separates the identity.
        let name = bookmark_file_name("Rust -- the book", id("0zx9y8w7"));
        assert_eq!(name, "Rust -- the book--0zx9y8w7.md");
        let (base, parsed) = parse_bookmark_file_name(&name).expect("parsable");
        assert_eq!(base, "Rust -- the book");
        assert_eq!(parsed, id("0zx9y8w7"));

        assert_eq!(parse_bookmark_file_name("README.md"), None);
        assert_eq!(parse_bookmark_file_name("no-suffix.md"), None);
        assert_eq!(parse_bookmark_file_name("React--TOOLONGID.md"), None);
        assert_eq!(parse_bookmark_file_name("React--A1B2C3D4.md"), None);
        assert_eq!(parse_bookmark_file_name("React--a1b2c3d4.txt"), None);
        assert!(parse_bookmark_file_name("React--a1b2c3d4.MD").is_some());
    }

    #[test]
    fn assets_directory_sits_beside_the_bookmark() {
        assert_eq!(
            assets_directory_name("React--a1b2c3d4.md"),
            "React--a1b2c3d4.assets"
        );
    }

    #[test]
    fn allocator_resolves_case_insensitive_collisions() {
        let mut allocator = NameAllocator::from_existing(["React"]);
        assert!(allocator.contains("react"));
        assert!(allocator.contains("REACT"));

        assert_eq!(allocator.allocate_folder("react"), "react-2");
        assert_eq!(allocator.allocate_folder("REACT"), "REACT-3");
        assert_eq!(allocator.allocate_folder("Vue"), "Vue");
    }

    #[test]
    fn allocator_keeps_identity_suffix_intact() {
        let mut allocator = NameAllocator::new();
        let first = allocator.allocate_bookmark("React", id("a1b2c3d4"));
        let second = allocator.allocate_bookmark("react", id("a1b2c3d4"));
        assert_eq!(first, "React--a1b2c3d4.md");
        assert_eq!(second, "react-2--a1b2c3d4.md");
        assert_eq!(
            parse_bookmark_file_name(&second).map(|(_, id)| id),
            Some(id("a1b2c3d4"))
        );
    }

    #[test]
    fn allocator_escapes_reserved_names_before_deduplicating() {
        let mut allocator = NameAllocator::new();
        assert_eq!(allocator.allocate_folder("con"), "_con");
        assert_eq!(allocator.allocate_folder("CON"), "_CON-2");
    }

    #[test]
    fn allocator_keeps_names_within_the_length_budget() {
        let mut allocator = NameAllocator::new();
        let title = "ä".repeat(300);
        for _ in 0..5 {
            let name = allocator.allocate_folder(&title);
            assert!(name.len() <= MAX_STEM_BYTES, "{} bytes", name.len());
        }
    }

    #[test]
    fn fold_key_is_unicode_aware() {
        assert_eq!(fold_key("STRASSE"), "strasse");
        assert_eq!(fold_key("Ärger"), "ärger");
    }
}
