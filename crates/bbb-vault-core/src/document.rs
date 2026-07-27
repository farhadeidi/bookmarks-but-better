//! Managed vault documents: bookmarks and folder metadata files.
//!
//! Parsing produces two things at once: the owned field values, and the byte
//! ranges those values occupy. Updating splices new bytes into those ranges and
//! copies everything else verbatim, which is what makes unknown front matter,
//! comments, key order, quoting style, the byte order mark, line endings and the
//! Markdown body survive every mutation.

use core::fmt;
use core::ops::Range;
use std::error::Error;

use crate::diagnostic::{Diagnostic, DiagnosticCode, Severity};
use crate::id::{Id, IdError};
use crate::revision::Revision;
use crate::timestamp::is_rfc3339;
use crate::yaml::{
    self, Entry, FrontmatterError, LineEnding, ScalarStyle, Unsupported, Value as YamlValue,
};

/// The front matter key holding a stable identity.
pub const KEY_ID: &str = "bbb_id";
/// The front matter key holding a bookmark's target URL.
pub const KEY_URL: &str = "bbb_url";
/// The front matter key holding a display title.
pub const KEY_TITLE: &str = "bbb_title";
/// The front matter key holding the creation timestamp.
pub const KEY_CREATED: &str = "bbb_created";
/// The front matter key holding the modification timestamp.
pub const KEY_UPDATED: &str = "bbb_updated";
/// The front matter key holding a vault-relative logo path.
pub const KEY_LOGO: &str = "bbb_logo";

/// The namespace this crate owns. Any other key is user data.
const OWNED_PREFIX: &str = "bbb_";

const BOOKMARK_KEYS: [&str; 6] = [
    KEY_ID,
    KEY_URL,
    KEY_TITLE,
    KEY_CREATED,
    KEY_UPDATED,
    KEY_LOGO,
];
const FOLDER_KEYS: [&str; 2] = [KEY_ID, KEY_TITLE];

/// Whether an entry may be written to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// The entry can be updated in place.
    ReadWrite,
    /// The entry has an [`Severity::Error`] diagnostic and must not be written.
    ReadOnly,
}

impl Access {
    fn of(diagnostics: &[Diagnostic]) -> Self {
        if diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity() == Severity::Error)
        {
            Self::ReadOnly
        } else {
            Self::ReadWrite
        }
    }

    /// A stable machine-readable name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ReadWrite => "read_write",
            Self::ReadOnly => "read_only",
        }
    }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Why a document cannot be treated as managed vault content.
///
/// Every variant means the same thing operationally: the file is surfaced
/// read-only with a diagnostic rather than rewritten on a guess.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum ParseError {
    /// The file is not valid UTF-8.
    InvalidUtf8 {
        /// How many leading bytes were valid.
        valid_up_to: usize,
    },
    /// The file has no `---` front matter block.
    MissingFrontmatter,
    /// The opening `---` is never closed.
    UnterminatedFrontmatter,
    /// The front matter root is not a mapping.
    NonMappingRoot {
        /// The 1-based line of the offending content.
        line: usize,
    },
    /// An owned key appears more than once, so its value is ambiguous.
    DuplicateOwnedKey {
        /// The duplicated key.
        key: &'static str,
        /// The 1-based line of the second occurrence.
        line: usize,
    },
    /// An owned key holds a value outside the supported single-line subset.
    UnsupportedValue {
        /// The offending key.
        key: &'static str,
        /// The 1-based line of the key.
        line: usize,
        /// What was found instead of a single-line scalar.
        found: &'static str,
    },
    /// `bbb_id` is present but is not a valid identity.
    InvalidId {
        /// The 1-based line of `bbb_id`.
        line: usize,
        /// Why the identity is invalid.
        reason: IdError,
    },
    /// The file carries no `bbb_id`, so it is ordinary Markdown, not a bookmark.
    NotManaged,
}

impl ParseError {
    /// The diagnostic code this failure is reported as.
    #[must_use]
    pub const fn code(&self) -> DiagnosticCode {
        match self {
            Self::InvalidUtf8 { .. } => DiagnosticCode::InvalidUtf8,
            Self::MissingFrontmatter | Self::NotManaged => DiagnosticCode::MissingFrontmatter,
            Self::UnterminatedFrontmatter => DiagnosticCode::UnterminatedFrontmatter,
            Self::NonMappingRoot { .. } => DiagnosticCode::NonMappingRoot,
            Self::DuplicateOwnedKey { .. } => DiagnosticCode::DuplicateOwnedKey,
            Self::UnsupportedValue { .. } => DiagnosticCode::UnsupportedValue,
            Self::InvalidId { .. } => DiagnosticCode::InvalidId,
        }
    }

    /// The 1-based line the failure was found on, when known.
    #[must_use]
    pub const fn line(&self) -> Option<usize> {
        match self {
            Self::NonMappingRoot { line }
            | Self::DuplicateOwnedKey { line, .. }
            | Self::UnsupportedValue { line, .. }
            | Self::InvalidId { line, .. } => Some(*line),
            _ => None,
        }
    }

    /// Renders this failure as a diagnostic for `path`.
    #[must_use]
    pub fn to_diagnostic(&self, path: impl Into<String>) -> Diagnostic {
        let diagnostic = Diagnostic::new(self.code(), self.to_string()).at_path(path);
        match self.line() {
            Some(line) => diagnostic.at_line(line),
            None => diagnostic,
        }
    }
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidUtf8 { valid_up_to } => write!(
                f,
                "the file is not valid UTF-8; the first invalid byte is at offset {valid_up_to}"
            ),
            Self::MissingFrontmatter => {
                f.write_str("the file does not start with a `---` front matter block")
            }
            Self::UnterminatedFrontmatter => f.write_str(
                "the front matter opened with `---` but is never closed by a `---` line",
            ),
            Self::NonMappingRoot { .. } => {
                f.write_str("the front matter must be a mapping of keys to values")
            }
            Self::DuplicateOwnedKey { key, .. } => {
                write!(
                    f,
                    "`{key}` appears more than once, so its value is ambiguous"
                )
            }
            Self::UnsupportedValue { key, found, .. } => {
                write!(f, "`{key}` must be a single-line scalar, but holds {found}")
            }
            Self::InvalidId { reason, .. } => write!(f, "`{KEY_ID}` is invalid: {reason}"),
            Self::NotManaged => write!(f, "the file has no `{KEY_ID}`, so it is not managed"),
        }
    }
}

impl Error for ParseError {}

/// Why an update was refused.
#[derive(Debug, Clone, PartialEq, Eq)]
#[non_exhaustive]
pub enum UpdateError {
    /// The document has an error-level diagnostic and must not be written.
    ReadOnly,
    /// The bytes handed to the update are not the bytes that were parsed.
    ///
    /// This is the optimistic concurrency check: it means the file changed
    /// underneath the caller and the update would have overwritten that change.
    StaleSource {
        /// The revision the document was parsed from.
        expected: Revision,
        /// The revision of the bytes that were supplied.
        actual: Revision,
    },
    /// A new value cannot be stored in the format.
    InvalidValue {
        /// The key being written.
        key: &'static str,
        /// Why the value was refused.
        reason: &'static str,
    },
}

impl fmt::Display for UpdateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::ReadOnly => f.write_str("the document is read-only"),
            Self::StaleSource { expected, actual } => write!(
                f,
                "the file changed on disk: expected revision {expected}, found {actual}"
            ),
            Self::InvalidValue { key, reason } => {
                write!(f, "`{key}` cannot be set: {reason}")
            }
        }
    }
}

impl Error for UpdateError {}

// ---------------------------------------------------------------------------
// Layout: where the owned values live in the original bytes
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
enum SlotValue {
    /// `key:` with no value; `span` is the whitespace after the colon.
    Empty { comment_follows: bool },
    /// A single-line scalar; `span` covers the token including its quotes.
    Scalar { style: ScalarStyle },
}

#[derive(Debug, Clone)]
struct Slot {
    span: Range<usize>,
    line_span: Range<usize>,
    line: usize,
    value: SlotValue,
}

#[derive(Debug, Clone)]
struct Layout {
    bom: bool,
    line_ending: LineEnding,
    insert_at: usize,
    slots: Vec<(&'static str, Slot)>,
}

impl Layout {
    fn slot(&self, key: &str) -> Option<&Slot> {
        self.slots
            .iter()
            .find_map(|(name, slot)| (*name == key).then_some(slot))
    }

    /// Builds the byte edit that writes `value` into `key`.
    ///
    /// Returns `Ok(None)` when the bytes on disk already say exactly that, which
    /// is what makes a no-op update byte-identical to its input.
    fn write(
        &self,
        source: &str,
        key: &'static str,
        value: &str,
    ) -> Result<Option<(Range<usize>, String)>, UpdateError> {
        let unencodable = || UpdateError::InvalidValue {
            key,
            reason: "the value cannot be written as a single-line scalar",
        };
        let Some(slot) = self.slot(key) else {
            // The key is absent: write a whole new line at the insertion point.
            let encoded = yaml::encode_scalar(value, None).ok_or_else(unencodable)?;
            return Ok(Some((
                self.insert_at..self.insert_at,
                format!("{key}: {encoded}{}", self.line_ending.as_str()),
            )));
        };

        let style = match slot.value {
            SlotValue::Scalar { style } => Some(style),
            SlotValue::Empty { .. } => None,
        };
        let encoded = yaml::encode_scalar(value, style).ok_or_else(unencodable)?;
        let replacement = match slot.value {
            SlotValue::Scalar { .. } => encoded,
            SlotValue::Empty { comment_follows } => {
                if comment_follows {
                    format!(" {encoded} ")
                } else {
                    format!(" {encoded}")
                }
            }
        };
        Ok((source[slot.span.clone()] != replacement).then(|| (slot.span.clone(), replacement)))
    }

    /// Builds the byte edit that removes `key` entirely.
    fn remove(&self, key: &str) -> Option<(Range<usize>, String)> {
        self.slot(key)
            .map(|slot| (slot.line_span.clone(), String::new()))
    }

    fn line_of(&self, key: &str) -> Option<usize> {
        self.slot(key).map(|slot| slot.line)
    }
}

/// Applies non-overlapping byte edits to `source`.
///
/// Edits are applied from the end backwards so earlier offsets stay valid, and
/// ties (two insertions at the same point) keep the order they were produced in.
fn splice(source: &[u8], edits: Vec<(Range<usize>, String)>) -> Vec<u8> {
    let mut ordered: Vec<(usize, Range<usize>, String)> = edits
        .into_iter()
        .enumerate()
        .map(|(index, (range, replacement))| (index, range, replacement))
        .collect();
    ordered.sort_by(|left, right| {
        right
            .1
            .start
            .cmp(&left.1.start)
            .then(right.1.end.cmp(&left.1.end))
            .then(right.0.cmp(&left.0))
    });

    let mut out = source.to_vec();
    for (_, range, replacement) in ordered {
        out.splice(range, replacement.into_bytes());
    }
    out
}

// ---------------------------------------------------------------------------
// Shared scanning
// ---------------------------------------------------------------------------

/// The state of one owned key in a document.
///
/// The three cases are genuinely different: an absent key has to be inserted, an
/// empty one has to be filled in place, and a present one has to be replaced.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Owned<'a> {
    /// The key does not appear at all.
    Absent,
    /// The key appears with no value, or with an explicit null.
    Empty,
    /// The key appears with a value.
    Present(&'a str),
}

impl<'a> Owned<'a> {
    const fn text(self) -> Option<&'a str> {
        match self {
            Self::Present(text) => Some(text),
            Self::Absent | Self::Empty => None,
        }
    }

    const fn is_absent(self) -> bool {
        matches!(self, Self::Absent)
    }
}

struct Scanned {
    layout: Layout,
    values: Vec<(&'static str, Option<String>)>,
    diagnostics: Vec<Diagnostic>,
}

impl Scanned {
    fn value(&self, key: &str) -> Owned<'_> {
        self.values
            .iter()
            .find(|(name, _)| *name == key)
            .map_or(Owned::Absent, |(_, value)| {
                value.as_deref().map_or(Owned::Empty, Owned::Present)
            })
    }
}

fn decode_utf8(bytes: &[u8]) -> Result<&str, ParseError> {
    core::str::from_utf8(bytes).map_err(|error| ParseError::InvalidUtf8 {
        valid_up_to: error.valid_up_to(),
    })
}

fn scan_owned(
    text: &str,
    owned: &[&'static str],
    path: Option<&str>,
) -> Result<Scanned, ParseError> {
    let frontmatter = yaml::parse(text).map_err(|error| match error {
        FrontmatterError::Missing => ParseError::MissingFrontmatter,
        FrontmatterError::Unterminated => ParseError::UnterminatedFrontmatter,
        FrontmatterError::NonMappingRoot { line } => ParseError::NonMappingRoot { line },
    })?;

    let mut diagnostics = Vec::new();
    let mut values: Vec<(&'static str, Option<String>)> = Vec::new();
    let mut slots: Vec<(&'static str, Slot)> = Vec::new();

    for key in owned {
        let mut matching = frontmatter.entries_named(key);
        let Some(entry) = matching.next() else {
            continue;
        };
        if let Some(duplicate) = matching.next() {
            return Err(ParseError::DuplicateOwnedKey {
                key,
                line: duplicate.line,
            });
        }

        let line_span = entry.start..entry.content_end;
        match &entry.value {
            YamlValue::Unsupported(reason) => {
                return Err(ParseError::UnsupportedValue {
                    key,
                    line: entry.line,
                    found: Unsupported::describe(*reason),
                });
            }
            YamlValue::Empty {
                span,
                comment_follows,
            } => {
                values.push((key, None));
                slots.push((
                    key,
                    Slot {
                        span: span.clone(),
                        line_span,
                        line: entry.line,
                        value: SlotValue::Empty {
                            comment_follows: *comment_follows,
                        },
                    },
                ));
            }
            YamlValue::Scalar { style, span, text } => {
                let is_null = *style == ScalarStyle::Plain && yaml::is_null_token(text);
                values.push((key, (!is_null).then(|| text.clone())));
                slots.push((
                    key,
                    Slot {
                        span: span.clone(),
                        line_span,
                        line: entry.line,
                        value: SlotValue::Scalar { style: *style },
                    },
                ));
            }
        }
    }

    diagnostics.extend(namespace_diagnostics(&frontmatter.entries, owned, path));

    let last_owned = frontmatter
        .entries
        .iter()
        .rev()
        .find(|entry| owned.contains(&entry.key.as_str()));

    Ok(Scanned {
        layout: Layout {
            bom: frontmatter.bom,
            line_ending: frontmatter.line_ending,
            insert_at: frontmatter.insertion_point(last_owned),
            slots,
        },
        values,
        diagnostics,
    })
}

/// Warns about reserved-but-unrecognised keys and about duplicated user keys.
fn namespace_diagnostics(
    entries: &[Entry],
    owned: &[&'static str],
    path: Option<&str>,
) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    for (index, entry) in entries.iter().enumerate() {
        let key = entry.key.as_str();
        if owned.contains(&key) {
            continue;
        }
        if key.starts_with(OWNED_PREFIX) {
            diagnostics.push(diagnose(
                DiagnosticCode::ReservedKeyUnknown,
                format!(
                    "`{key}` uses the reserved `{OWNED_PREFIX}` namespace but is not part of the \
                     vault format; it is preserved but ignored"
                ),
                path,
                Some(entry.line),
            ));
        }
        if entries[..index].iter().any(|other| other.key == entry.key) {
            diagnostics.push(diagnose(
                DiagnosticCode::DuplicateKey,
                format!("`{key}` appears more than once, which other YAML readers reject"),
                path,
                Some(entry.line),
            ));
        }
    }
    diagnostics
}

fn diagnose(
    code: DiagnosticCode,
    detail: String,
    path: Option<&str>,
    line: Option<usize>,
) -> Diagnostic {
    let mut diagnostic = Diagnostic::new(code, detail);
    if let Some(path) = path {
        diagnostic = diagnostic.at_path(path);
    }
    if let Some(line) = line {
        diagnostic = diagnostic.at_line(line);
    }
    diagnostic
}

fn require_identity(scanned: &Scanned) -> Result<Id, ParseError> {
    let line = scanned.layout.line_of(KEY_ID).unwrap_or(1);
    match scanned.value(KEY_ID) {
        Owned::Absent => Err(ParseError::NotManaged),
        Owned::Empty => Err(ParseError::InvalidId {
            line,
            reason: IdError::Length { actual: 0 },
        }),
        Owned::Present(text) => {
            Id::parse(text).map_err(|reason| ParseError::InvalidId { line, reason })
        }
    }
}

fn check_timestamp(
    scanned: &Scanned,
    key: &'static str,
    path: Option<&str>,
    diagnostics: &mut Vec<Diagnostic>,
) -> Option<String> {
    let line = scanned.layout.line_of(key);
    let Some(text) = scanned.value(key).text() else {
        diagnostics.push(diagnose(
            DiagnosticCode::MissingRequiredField,
            format!("`{key}` is missing; it will be filled in on the next write"),
            path,
            line,
        ));
        return None;
    };
    if !is_rfc3339(text) {
        diagnostics.push(diagnose(
            DiagnosticCode::InvalidTimestamp,
            format!("`{key}` is not an RFC 3339 timestamp: {text:?}"),
            path,
            line,
        ));
    }
    Some(text.to_owned())
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

/// A parsed bookmark file.
///
/// The struct owns the field values and the byte ranges they came from, but not
/// the source bytes. [`BookmarkFile::apply`] takes those bytes back and verifies
/// they are unchanged before touching them.
#[derive(Debug, Clone)]
pub struct BookmarkFile {
    revision: Revision,
    id: Id,
    url: Option<String>,
    title: Option<String>,
    created: Option<String>,
    updated: Option<String>,
    logo: Option<String>,
    access: Access,
    diagnostics: Vec<Diagnostic>,
    layout: Layout,
}

impl BookmarkFile {
    /// Parses a bookmark file.
    ///
    /// # Errors
    ///
    /// Returns [`ParseError`] for anything that cannot be updated safely, and
    /// [`ParseError::NotManaged`] for ordinary Markdown that simply has no
    /// `bbb_id`.
    pub fn parse(bytes: &[u8]) -> Result<Self, ParseError> {
        Self::parse_at(bytes, None)
    }

    /// Parses a bookmark file, labelling every diagnostic with `path`.
    ///
    /// # Errors
    ///
    /// As [`BookmarkFile::parse`].
    pub fn parse_at(bytes: &[u8], path: Option<&str>) -> Result<Self, ParseError> {
        let text = decode_utf8(bytes)?;
        let mut scanned = scan_owned(text, &BOOKMARK_KEYS, path)?;
        let id = require_identity(&scanned)?;

        let mut diagnostics = core::mem::take(&mut scanned.diagnostics);

        let raw_url = scanned.value(KEY_URL);
        let url = raw_url.text().filter(|url| !url.trim().is_empty());
        if url.is_none() {
            let detail = if raw_url.is_absent() {
                format!("`{KEY_URL}` is missing; a bookmark must have a URL")
            } else {
                format!("`{KEY_URL}` is empty; a bookmark must have a URL")
            };
            diagnostics.push(diagnose(
                DiagnosticCode::EmptyUrl,
                detail,
                path,
                scanned.layout.line_of(KEY_URL),
            ));
        }
        let url = url.map(str::to_owned);

        let title = scanned
            .value(KEY_TITLE)
            .text()
            .filter(|title| !title.is_empty())
            .map(str::to_owned);
        if title.is_none() {
            diagnostics.push(diagnose(
                DiagnosticCode::MissingRequiredField,
                format!("`{KEY_TITLE}` is missing; the filename is used instead"),
                path,
                scanned.layout.line_of(KEY_TITLE),
            ));
        }

        let created = check_timestamp(&scanned, KEY_CREATED, path, &mut diagnostics);
        let updated = check_timestamp(&scanned, KEY_UPDATED, path, &mut diagnostics);
        let logo = scanned
            .value(KEY_LOGO)
            .text()
            .filter(|logo| !logo.is_empty())
            .map(str::to_owned);

        Ok(Self {
            revision: Revision::of(bytes),
            id,
            url,
            title,
            created,
            updated,
            logo,
            access: Access::of(&diagnostics),
            diagnostics,
            layout: scanned.layout,
        })
    }

    /// The stable identity.
    #[must_use]
    pub const fn id(&self) -> Id {
        self.id
    }

    /// The target URL, absent only on a read-only bookmark.
    #[must_use]
    pub fn url(&self) -> Option<&str> {
        self.url.as_deref()
    }

    /// The display title, absent when the filename should be used instead.
    #[must_use]
    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    /// The creation timestamp exactly as written on disk.
    #[must_use]
    pub fn created(&self) -> Option<&str> {
        self.created.as_deref()
    }

    /// The modification timestamp exactly as written on disk.
    #[must_use]
    pub fn updated(&self) -> Option<&str> {
        self.updated.as_deref()
    }

    /// The vault-relative path of a user-supplied logo.
    #[must_use]
    pub fn logo(&self) -> Option<&str> {
        self.logo.as_deref()
    }

    /// The content revision of the bytes this was parsed from.
    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    /// Whether the file starts with a UTF-8 byte order mark.
    ///
    /// Reported rather than removed: the mark is part of the user's bytes.
    #[must_use]
    pub const fn has_bom(&self) -> bool {
        self.layout.bom
    }

    /// Whether the file uses `\r\n` line endings.
    #[must_use]
    pub fn is_crlf(&self) -> bool {
        self.layout.line_ending == LineEnding::Crlf
    }

    /// Whether the bookmark may be written to.
    #[must_use]
    pub const fn access(&self) -> Access {
        self.access
    }

    /// Everything that is not canonical about this file.
    #[must_use]
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }

    /// Rewrites the owned fields named by `update`, leaving every other byte
    /// alone.
    ///
    /// `source` must be the exact bytes this document was parsed from; that is
    /// the optimistic concurrency check. An update that changes nothing returns
    /// `source` unchanged, byte for byte.
    ///
    /// # Errors
    ///
    /// Returns [`UpdateError::ReadOnly`] when the document has an error-level
    /// diagnostic, [`UpdateError::StaleSource`] when `source` has changed since
    /// parsing, and [`UpdateError::InvalidValue`] when a new value cannot be
    /// represented as a single-line scalar.
    pub fn apply(&self, source: &[u8], update: &BookmarkUpdate) -> Result<Vec<u8>, UpdateError> {
        let text = check_source(self.access, self.revision, source)?;
        let mut edits = Vec::new();

        for (key, value) in [
            (KEY_URL, update.url.as_deref()),
            (KEY_TITLE, update.title.as_deref()),
            (KEY_CREATED, update.created.as_deref()),
            (KEY_UPDATED, update.updated.as_deref()),
        ] {
            let Some(value) = value else { continue };
            validate(key, value)?;
            edits.extend(self.layout.write(text, key, value)?);
        }

        match &update.logo {
            None => {}
            Some(FieldChange::Clear) => edits.extend(self.layout.remove(KEY_LOGO)),
            Some(FieldChange::Set(logo)) => {
                validate(KEY_LOGO, logo)?;
                edits.extend(self.layout.write(text, KEY_LOGO, logo)?);
            }
        }

        Ok(splice(source, edits))
    }
}

/// Rejects a write when the document is read-only or the bytes have moved on.
fn check_source(access: Access, revision: Revision, source: &[u8]) -> Result<&str, UpdateError> {
    if access == Access::ReadOnly {
        return Err(UpdateError::ReadOnly);
    }
    let actual = Revision::of(source);
    let stale = || UpdateError::StaleSource {
        expected: revision,
        actual,
    };
    if actual != revision {
        return Err(stale());
    }
    // Unreachable in practice: a matching revision means matching bytes, and the
    // bytes that were parsed were valid UTF-8.
    core::str::from_utf8(source).map_err(|_| stale())
}

fn validate(key: &'static str, value: &str) -> Result<(), UpdateError> {
    if value.chars().any(char::is_control) {
        return Err(UpdateError::InvalidValue {
            key,
            reason: "values must not contain line breaks or control characters",
        });
    }
    match key {
        KEY_URL if value.trim().is_empty() => Err(UpdateError::InvalidValue {
            key,
            reason: "a bookmark must have a URL",
        }),
        KEY_LOGO if value.trim().is_empty() => Err(UpdateError::InvalidValue {
            key,
            reason: "use the clearing form instead of an empty path",
        }),
        KEY_CREATED | KEY_UPDATED if !is_rfc3339(value) => Err(UpdateError::InvalidValue {
            key,
            reason: "timestamps must be RFC 3339",
        }),
        _ => Ok(()),
    }
}

/// A requested change to an optional owned field.
#[derive(Debug, Clone, PartialEq, Eq)]
enum FieldChange {
    /// Write this value, inserting the key when it is absent.
    Set(String),
    /// Delete the key and its whole line.
    Clear,
}

/// The owned bookmark fields to rewrite.
///
/// `bbb_id` is deliberately absent: identity is immutable.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BookmarkUpdate {
    url: Option<String>,
    title: Option<String>,
    created: Option<String>,
    updated: Option<String>,
    logo: Option<FieldChange>,
}

impl BookmarkUpdate {
    /// An update that changes nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `bbb_url`.
    #[must_use]
    pub fn url(mut self, value: impl Into<String>) -> Self {
        self.url = Some(value.into());
        self
    }

    /// Sets `bbb_title`.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(value.into());
        self
    }

    /// Sets `bbb_created`.
    #[must_use]
    pub fn created(mut self, value: impl Into<String>) -> Self {
        self.created = Some(value.into());
        self
    }

    /// Sets `bbb_updated`.
    #[must_use]
    pub fn updated(mut self, value: impl Into<String>) -> Self {
        self.updated = Some(value.into());
        self
    }

    /// Sets `bbb_logo`, inserting the key when it is absent.
    #[must_use]
    pub fn logo(mut self, value: impl Into<String>) -> Self {
        self.logo = Some(FieldChange::Set(value.into()));
        self
    }

    /// Removes `bbb_logo` and its whole line.
    #[must_use]
    pub fn clear_logo(mut self) -> Self {
        self.logo = Some(FieldChange::Clear);
        self
    }
}

// ---------------------------------------------------------------------------
// Folder metadata
// ---------------------------------------------------------------------------

/// A parsed `.bbb-folder.md` metadata file.
#[derive(Debug, Clone)]
pub struct FolderFile {
    revision: Revision,
    id: Id,
    title: Option<String>,
    access: Access,
    diagnostics: Vec<Diagnostic>,
    layout: Layout,
}

impl FolderFile {
    /// Parses a folder metadata file.
    ///
    /// # Errors
    ///
    /// As [`BookmarkFile::parse`]. A folder file without `bbb_id` is an error
    /// rather than ordinary Markdown, because carrying identity is the only
    /// reason the file exists.
    pub fn parse(bytes: &[u8]) -> Result<Self, ParseError> {
        Self::parse_at(bytes, None)
    }

    /// Parses a folder metadata file, labelling every diagnostic with `path`.
    ///
    /// # Errors
    ///
    /// As [`FolderFile::parse`].
    pub fn parse_at(bytes: &[u8], path: Option<&str>) -> Result<Self, ParseError> {
        let text = decode_utf8(bytes)?;
        let mut scanned = scan_owned(text, &FOLDER_KEYS, path)?;
        let id = require_identity(&scanned).map_err(|error| match error {
            ParseError::NotManaged => ParseError::InvalidId {
                line: 1,
                reason: IdError::Length { actual: 0 },
            },
            other => other,
        })?;

        let title = scanned
            .value(KEY_TITLE)
            .text()
            .filter(|title| !title.is_empty())
            .map(str::to_owned);

        let diagnostics = core::mem::take(&mut scanned.diagnostics);
        Ok(Self {
            revision: Revision::of(bytes),
            id,
            title,
            access: Access::of(&diagnostics),
            diagnostics,
            layout: scanned.layout,
        })
    }

    /// The stable identity of the directory this file sits in.
    #[must_use]
    pub const fn id(&self) -> Id {
        self.id
    }

    /// The display title, absent when the directory name should be used.
    #[must_use]
    pub fn title(&self) -> Option<&str> {
        self.title.as_deref()
    }

    /// The content revision of the bytes this was parsed from.
    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    /// Whether the file starts with a UTF-8 byte order mark.
    #[must_use]
    pub const fn has_bom(&self) -> bool {
        self.layout.bom
    }

    /// Whether the file uses `\r\n` line endings.
    #[must_use]
    pub fn is_crlf(&self) -> bool {
        self.layout.line_ending == LineEnding::Crlf
    }

    /// Whether the folder metadata may be written to.
    #[must_use]
    pub const fn access(&self) -> Access {
        self.access
    }

    /// Everything that is not canonical about this file.
    #[must_use]
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }

    /// Rewrites `bbb_title`, leaving every other byte alone.
    ///
    /// # Errors
    ///
    /// As [`BookmarkFile::apply`].
    pub fn apply(&self, source: &[u8], update: &FolderUpdate) -> Result<Vec<u8>, UpdateError> {
        let text = check_source(self.access, self.revision, source)?;
        let mut edits = Vec::new();
        match &update.title {
            None => {}
            Some(FieldChange::Clear) => edits.extend(self.layout.remove(KEY_TITLE)),
            Some(FieldChange::Set(title)) => {
                validate(KEY_TITLE, title)?;
                edits.extend(self.layout.write(text, KEY_TITLE, title)?);
            }
        }
        Ok(splice(source, edits))
    }
}

/// The owned folder fields to rewrite.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FolderUpdate {
    title: Option<FieldChange>,
}

impl FolderUpdate {
    /// An update that changes nothing.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets `bbb_title`, inserting the key when it is absent.
    #[must_use]
    pub fn title(mut self, value: impl Into<String>) -> Self {
        self.title = Some(FieldChange::Set(value.into()));
        self
    }

    /// Removes `bbb_title` and its whole line.
    #[must_use]
    pub fn clear_title(mut self) -> Self {
        self.title = Some(FieldChange::Clear);
        self
    }
}

fn push_entry(out: &mut String, key: &str, encoded: &str) {
    out.push_str(key);
    out.push_str(": ");
    out.push_str(encoded);
    out.push('\n');
}

/// Renders a minimal, canonical bookmark file with LF line endings.
///
/// This is the only place the crate writes a whole document, because it is the
/// only case where there is nothing on disk to preserve.
///
/// # Errors
///
/// Returns [`UpdateError::InvalidValue`] when a field cannot be stored, for the
/// same reasons [`BookmarkFile::apply`] would refuse it.
pub fn render_bookmark(
    id: Id,
    url: &str,
    title: &str,
    created: &str,
    updated: &str,
) -> Result<String, UpdateError> {
    let mut out = format!("---\n{KEY_ID}: {id}\n");
    for (key, value) in [
        (KEY_URL, url),
        (KEY_TITLE, title),
        (KEY_CREATED, created),
        (KEY_UPDATED, updated),
    ] {
        validate(key, value)?;
        let encoded = yaml::encode_scalar(value, None).ok_or(UpdateError::InvalidValue {
            key,
            reason: "the value cannot be written as a single-line scalar",
        })?;
        push_entry(&mut out, key, &encoded);
    }
    out.push_str("---\n");
    Ok(out)
}

/// Renders a minimal, canonical `.bbb-folder.md` with LF line endings.
///
/// # Errors
///
/// Returns [`UpdateError::InvalidValue`] when `title` cannot be stored.
pub fn render_folder(id: Id, title: Option<&str>) -> Result<String, UpdateError> {
    let mut out = format!("---\n{KEY_ID}: {id}\n");
    if let Some(title) = title {
        validate(KEY_TITLE, title)?;
        let encoded = yaml::encode_scalar(title, None).ok_or(UpdateError::InvalidValue {
            key: KEY_TITLE,
            reason: "the value cannot be written as a single-line scalar",
        })?;
        push_entry(&mut out, KEY_TITLE, &encoded);
    }
    out.push_str("---\n");
    Ok(out)
}
