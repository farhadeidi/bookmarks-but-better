//! A line-oriented scanner for the YAML front matter subset the vault owns.
//!
//! This is deliberately *not* a YAML implementation. The vault never rebuilds a
//! document from a parsed model, so the only thing it needs from front matter is
//! the byte range of each top-level key and, for the keys it owns, the byte
//! range and decoded text of a single-line scalar value.
//!
//! Anything outside that subset — block scalars, flow collections, anchors,
//! aliases, tags, nested blocks, multi-line plain scalars — is recognised and
//! reported as unsupported rather than guessed at. Unknown keys keep whatever
//! shape they have; the scanner only records where they start and end so that
//! an edit can be spliced around them.

use std::ops::Range;

/// The line terminator a document uses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LineEnding {
    /// `\n`
    Lf,
    /// `\r\n`
    Crlf,
}

impl LineEnding {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Lf => "\n",
            Self::Crlf => "\r\n",
        }
    }
}

/// How a scalar is written in the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScalarStyle {
    Plain,
    SingleQuoted,
    DoubleQuoted,
}

/// Why a value cannot be updated in place.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Unsupported {
    /// `key: |` or `key: >`.
    BlockScalar,
    /// `key: [a, b]` or `key: {a: b}`.
    FlowCollection,
    /// The value continues onto following, more indented lines.
    NestedBlock,
    /// A quoted scalar that is not closed on its own line.
    MultilineScalar,
    /// `key: &anchor`, `key: *alias` or `key: !tag`.
    AnchorAliasTag,
    /// The value is not valid YAML at all.
    Malformed,
}

impl Unsupported {
    pub(crate) const fn describe(self) -> &'static str {
        match self {
            Self::BlockScalar => "a block scalar",
            Self::FlowCollection => "a flow collection",
            Self::NestedBlock => "a nested block",
            Self::MultilineScalar => "a value spanning several lines",
            Self::AnchorAliasTag => "an anchor, alias or tag",
            Self::Malformed => "a malformed value",
        }
    }
}

/// The value side of a top-level mapping entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Value {
    /// `key:` with nothing but optional spaces and an optional comment after it.
    Empty {
        /// The run of spaces between the colon and the comment or line end.
        span: Range<usize>,
        /// Whether a comment follows on the same line.
        comment_follows: bool,
    },
    /// A single-line scalar that can be replaced byte for byte.
    Scalar {
        style: ScalarStyle,
        /// The exact bytes of the scalar token, quotes included.
        span: Range<usize>,
        /// The decoded text.
        text: String,
    },
    /// A value outside the supported subset.
    Unsupported(Unsupported),
}

/// A top-level mapping entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Entry {
    /// The decoded key.
    pub(crate) key: String,
    /// The byte offset of the first character of the key.
    pub(crate) start: usize,
    /// The 1-based line the key appears on.
    pub(crate) line: usize,
    /// The end of the entry's own lines, including the final terminator but not
    /// any trailing blank or comment lines. New entries are inserted here.
    pub(crate) content_end: usize,
    pub(crate) value: Value,
}

/// A parsed front matter block.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Frontmatter {
    /// Whether the document starts with a UTF-8 byte order mark.
    pub(crate) bom: bool,
    /// The YAML region, between the delimiter lines.
    pub(crate) content: Range<usize>,
    /// The line terminator used by the opening delimiter.
    pub(crate) line_ending: LineEnding,
    pub(crate) entries: Vec<Entry>,
}

impl Frontmatter {
    /// Returns every entry whose key is `key`.
    pub(crate) fn entries_named<'a>(&'a self, key: &'a str) -> impl Iterator<Item = &'a Entry> {
        self.entries.iter().filter(move |entry| entry.key == key)
    }

    /// Returns the byte offset at which a new top-level entry should be written.
    ///
    /// New keys land immediately after `after`, when it exists, so that owned
    /// keys stay grouped together instead of drifting to the end of a block the
    /// user has arranged by hand.
    pub(crate) fn insertion_point(&self, after: Option<&Entry>) -> usize {
        after
            .or_else(|| self.entries.last())
            .map_or(self.content.start, |entry| entry.content_end)
    }
}

/// Why a document has no usable front matter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FrontmatterError {
    /// The document does not begin with a `---` line.
    Missing,
    /// The opening `---` is never closed.
    Unterminated,
    /// The front matter is not a mapping of keys to values.
    NonMappingRoot {
        /// The 1-based line of the offending content.
        line: usize,
    },
}

const DELIMITER: &str = "---";

/// Scans the front matter of `text`.
///
/// Offsets in the result are byte offsets into `text`, including any byte order
/// mark, so they can be applied directly to the original file bytes.
pub(crate) fn parse(text: &str) -> Result<Frontmatter, FrontmatterError> {
    let bom = text.starts_with('\u{feff}');
    let start = if bom { '\u{feff}'.len_utf8() } else { 0 };

    let opening = read_line(text, start, text.len()).ok_or(FrontmatterError::Missing)?;
    if strip_carriage_return(&text[opening.content.clone()]) != DELIMITER {
        return Err(FrontmatterError::Missing);
    }
    if opening.next == opening.content.end {
        // The delimiter is the last line and has no terminator at all.
        return Err(FrontmatterError::Unterminated);
    }
    let line_ending = if text[opening.content.clone()].ends_with('\r') {
        LineEnding::Crlf
    } else {
        LineEnding::Lf
    };

    let content_start = opening.next;
    let mut cursor = content_start;
    let mut closing = None;
    while let Some(line) = read_line(text, cursor, text.len()) {
        if strip_carriage_return(&text[line.content.clone()]) == DELIMITER {
            closing = Some(line.content.start);
            break;
        }
        cursor = line.next;
    }
    let content_end = closing.ok_or(FrontmatterError::Unterminated)?;

    let entries = parse_entries(text, content_start..content_end)?;

    Ok(Frontmatter {
        bom,
        content: content_start..content_end,
        line_ending,
        entries,
    })
}

/// Returns the 1-based line number containing `offset`.
pub(crate) fn line_of(text: &str, offset: usize) -> usize {
    text[..offset.min(text.len())].matches('\n').count() + 1
}

struct Line {
    /// The line without its terminator.
    content: Range<usize>,
    /// The start of the next line, or the end of the region.
    next: usize,
}

fn read_line(text: &str, from: usize, end: usize) -> Option<Line> {
    if from >= end {
        return None;
    }
    let region = &text[from..end];
    match region.find('\n') {
        Some(index) => Some(Line {
            content: from..from + index,
            next: from + index + 1,
        }),
        None => Some(Line {
            content: from..end,
            next: end,
        }),
    }
}

fn strip_carriage_return(line: &str) -> &str {
    line.strip_suffix('\r').unwrap_or(line)
}

fn parse_entries(text: &str, region: Range<usize>) -> Result<Vec<Entry>, FrontmatterError> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut cursor = region.start;

    while let Some(line) = read_line(text, cursor, region.end) {
        let raw = strip_carriage_return(&text[line.content.clone()]);
        let indent = raw.len() - raw.trim_start_matches([' ', '\t']).len();
        let body = &raw[indent..];

        if body.is_empty() || body.starts_with('#') {
            // Blank lines and comments never turn a scalar into a block, and
            // never move the point at which a new key would be inserted.
            cursor = line.next;
            continue;
        }

        if indent > 0 {
            let Some(last) = entries.last_mut() else {
                return Err(FrontmatterError::NonMappingRoot {
                    line: line_of(text, line.content.start),
                });
            };
            last.content_end = line.next;
            last.value = match last.value {
                Value::Unsupported(reason) => Value::Unsupported(reason),
                Value::Empty { .. } => Value::Unsupported(Unsupported::NestedBlock),
                Value::Scalar { .. } => Value::Unsupported(Unsupported::MultilineScalar),
            };
            cursor = line.next;
            continue;
        }

        let entry = parse_entry(text, line.content.start, line.content.start + body.len())?;
        entries.push(Entry {
            content_end: line.next,
            ..entry
        });
        cursor = line.next;
    }

    Ok(entries)
}

fn parse_entry(text: &str, start: usize, end: usize) -> Result<Entry, FrontmatterError> {
    let line = line_of(text, start);
    let non_mapping = || FrontmatterError::NonMappingRoot { line };
    let body = &text[start..end];

    // A sequence item, an explicit key, a directive or a document marker at the
    // root means the front matter is not a plain mapping.
    if body == "-"
        || body.starts_with("- ")
        || body.starts_with("? ")
        || body.starts_with('%')
        || body.starts_with(':')
    {
        return Err(non_mapping());
    }

    let (key, after_key) = match body.as_bytes().first() {
        Some(b'"') => {
            let (text, offset) = scan_double_quoted(body, 0).ok_or_else(non_mapping)?;
            (text, offset)
        }
        Some(b'\'') => {
            let (text, offset) = scan_single_quoted(body, 0).ok_or_else(non_mapping)?;
            (text, offset)
        }
        _ => {
            let index = find_plain_key_end(body).ok_or_else(non_mapping)?;
            (body[..index].trim_end().to_owned(), index)
        }
    };

    let rest = &body[after_key..];
    let colon = rest
        .trim_start_matches([' ', '\t'])
        .starts_with(':')
        .then(|| after_key + rest.len() - rest.trim_start_matches([' ', '\t']).len() + 1)
        .ok_or_else(non_mapping)?;

    if key.is_empty() {
        return Err(non_mapping());
    }

    Ok(Entry {
        key,
        start,
        line,
        content_end: end,
        value: parse_value(text, start + colon, end),
    })
}

/// Finds the end of a plain key: the first `:` followed by a space, a tab or the
/// end of the line.
fn find_plain_key_end(body: &str) -> Option<usize> {
    let bytes = body.as_bytes();
    bytes.iter().enumerate().find_map(|(index, byte)| {
        (*byte == b':' && matches!(bytes.get(index + 1), None | Some(b' ' | b'\t')) && index > 0)
            .then_some(index)
    })
}

fn parse_value(text: &str, colon_end: usize, end: usize) -> Value {
    let segment = &text[colon_end..end];
    let leading = segment.len() - segment.trim_start_matches([' ', '\t']).len();
    let value_start = colon_end + leading;
    let rest = &text[value_start..end];

    if rest.is_empty() || rest.starts_with('#') {
        return Value::Empty {
            span: colon_end..value_start,
            comment_follows: rest.starts_with('#'),
        };
    }

    match rest.as_bytes()[0] {
        b'|' | b'>' => Value::Unsupported(Unsupported::BlockScalar),
        b'[' | b']' | b'{' | b'}' => Value::Unsupported(Unsupported::FlowCollection),
        b'&' | b'*' | b'!' => Value::Unsupported(Unsupported::AnchorAliasTag),
        b'\'' => match scan_single_quoted(rest, 0) {
            Some((decoded, consumed)) if trailing_is_comment(&rest[consumed..]) => Value::Scalar {
                style: ScalarStyle::SingleQuoted,
                span: value_start..value_start + consumed,
                text: decoded,
            },
            Some(_) => Value::Unsupported(Unsupported::Malformed),
            None => Value::Unsupported(Unsupported::MultilineScalar),
        },
        b'"' => match scan_double_quoted(rest, 0) {
            Some((decoded, consumed)) if trailing_is_comment(&rest[consumed..]) => Value::Scalar {
                style: ScalarStyle::DoubleQuoted,
                span: value_start..value_start + consumed,
                text: decoded,
            },
            Some(_) => Value::Unsupported(Unsupported::Malformed),
            None => Value::Unsupported(Unsupported::MultilineScalar),
        },
        _ => parse_plain(rest, value_start),
    }
}

fn parse_plain(rest: &str, value_start: usize) -> Value {
    let cut = rest
        .match_indices(['#'])
        .find(|(index, _)| {
            matches!(
                rest.as_bytes().get(index.wrapping_sub(1)),
                Some(b' ' | b'\t')
            )
        })
        .map_or(rest.len(), |(index, _)| index);
    let token = rest[..cut].trim_end_matches([' ', '\t']);

    if token.is_empty() {
        return Value::Unsupported(Unsupported::Malformed);
    }
    // `key: a: b` is a mapping value inside a mapping value, which YAML rejects.
    if token.contains(": ") || token.ends_with(':') || token.contains('\t') {
        return Value::Unsupported(Unsupported::Malformed);
    }

    Value::Scalar {
        style: ScalarStyle::Plain,
        span: value_start..value_start + token.len(),
        text: token.to_owned(),
    }
}

/// Whether everything after a closing quote is blank or a comment.
fn trailing_is_comment(tail: &str) -> bool {
    let trimmed = tail.trim_start_matches([' ', '\t']);
    trimmed.is_empty() || (trimmed.starts_with('#') && trimmed.len() < tail.len())
}

/// Scans a single-quoted scalar starting at `from`, returning its decoded text
/// and the number of bytes consumed, or `None` when it is not closed.
fn scan_single_quoted(text: &str, from: usize) -> Option<(String, usize)> {
    let bytes = text.as_bytes();
    let mut decoded = String::new();
    let mut index = from + 1;
    while index < bytes.len() {
        if bytes[index] == b'\'' {
            if bytes.get(index + 1) == Some(&b'\'') {
                decoded.push('\'');
                index += 2;
                continue;
            }
            return Some((decoded, index + 1));
        }
        let end = next_char_boundary(text, index);
        decoded.push_str(&text[index..end]);
        index = end;
    }
    None
}

/// Scans a double-quoted scalar starting at `from`, returning its decoded text
/// and the number of bytes consumed, or `None` when it is not closed.
fn scan_double_quoted(text: &str, from: usize) -> Option<(String, usize)> {
    let bytes = text.as_bytes();
    let mut decoded = String::new();
    let mut index = from + 1;
    while index < bytes.len() {
        match bytes[index] {
            b'"' => return Some((decoded, index + 1)),
            b'\\' => {
                let (character, consumed) = decode_escape(text, index)?;
                decoded.push(character);
                index += consumed;
            }
            _ => {
                let end = next_char_boundary(text, index);
                decoded.push_str(&text[index..end]);
                index = end;
            }
        }
    }
    None
}

fn decode_escape(text: &str, index: usize) -> Option<(char, usize)> {
    let bytes = text.as_bytes();
    let escape = *bytes.get(index + 1)?;
    let simple = |character: char| Some((character, 2));
    match escape {
        b'0' => simple('\0'),
        b'a' => simple('\u{7}'),
        b'b' => simple('\u{8}'),
        b't' | b'\t' => simple('\t'),
        b'n' => simple('\n'),
        b'v' => simple('\u{b}'),
        b'f' => simple('\u{c}'),
        b'r' => simple('\r'),
        b'e' => simple('\u{1b}'),
        b' ' => simple(' '),
        b'"' => simple('"'),
        b'/' => simple('/'),
        b'\\' => simple('\\'),
        b'N' => simple('\u{85}'),
        b'_' => simple('\u{a0}'),
        b'L' => simple('\u{2028}'),
        b'P' => simple('\u{2029}'),
        b'x' => decode_hex_escape(text, index + 2, 2).map(|character| (character, 4)),
        b'u' => decode_hex_escape(text, index + 2, 4).map(|character| (character, 6)),
        b'U' => decode_hex_escape(text, index + 2, 8).map(|character| (character, 10)),
        _ => None,
    }
}

fn decode_hex_escape(text: &str, from: usize, digits: usize) -> Option<char> {
    let slice = text.get(from..from + digits)?;
    char::from_u32(u32::from_str_radix(slice, 16).ok()?)
}

fn next_char_boundary(text: &str, index: usize) -> usize {
    let mut end = index + 1;
    while end < text.len() && !text.is_char_boundary(end) {
        end += 1;
    }
    end.min(text.len())
}

/// Encodes `value` as a single-line YAML scalar.
///
/// The existing style is kept whenever it can still represent the value, so an
/// update to a double-quoted field stays double-quoted and produces the smallest
/// possible diff. Returns `None` when `value` cannot live on one line.
pub(crate) fn encode_scalar(value: &str, preferred: Option<ScalarStyle>) -> Option<String> {
    if value.chars().any(char::is_control) {
        return None;
    }

    let style = match preferred {
        Some(ScalarStyle::SingleQuoted) => ScalarStyle::SingleQuoted,
        Some(ScalarStyle::DoubleQuoted) => ScalarStyle::DoubleQuoted,
        _ if is_plain_safe(value) => ScalarStyle::Plain,
        _ => ScalarStyle::DoubleQuoted,
    };

    Some(match style {
        ScalarStyle::Plain => value.to_owned(),
        ScalarStyle::SingleQuoted => format!("'{}'", value.replace('\'', "''")),
        ScalarStyle::DoubleQuoted => {
            format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
        }
    })
}

/// Indicator characters that may not start a plain scalar.
const PLAIN_INDICATORS: [char; 18] = [
    '-', '?', ':', ',', '[', ']', '{', '}', '#', '&', '*', '!', '|', '>', '\'', '"', '%', '@',
];

fn is_plain_safe(value: &str) -> bool {
    let Some(first) = value.chars().next() else {
        return false;
    };
    if PLAIN_INDICATORS.contains(&first) || first == '`' {
        return false;
    }
    if value.starts_with(' ') || value.ends_with(' ') || value.contains('\t') {
        return false;
    }
    if value.contains(": ") || value.ends_with(':') || value.contains(" #") {
        return false;
    }
    !resolves_to_non_string(value)
}

/// Whether a plain scalar would be read back as something other than a string.
///
/// Date-like text is deliberately excluded: the vault stores RFC 3339 timestamps
/// plain, reads them back as text, and keeping them unquoted matches what every
/// other Markdown tool writes.
fn resolves_to_non_string(value: &str) -> bool {
    const KEYWORDS: [&str; 11] = [
        "true", "false", "yes", "no", "on", "off", "null", "nil", "~", ".inf", ".nan",
    ];
    let lowered = value.to_ascii_lowercase();
    if KEYWORDS.contains(&lowered.as_str()) || lowered.starts_with("-.inf") || lowered == "+.inf" {
        return true;
    }
    let numeric = lowered.replace('_', "");
    numeric.parse::<i64>().is_ok()
        || numeric.parse::<f64>().is_ok()
        || numeric.starts_with("0x")
        || numeric.starts_with("0o")
        || numeric.starts_with("0b")
}

/// Returns `true` when a plain scalar reads back as "no value".
pub(crate) fn is_null_token(value: &str) -> bool {
    matches!(value, "~" | "null" | "Null" | "NULL")
}

#[cfg(test)]
mod tests {
    use super::{
        FrontmatterError, LineEnding, ScalarStyle, Unsupported, Value, encode_scalar,
        is_null_token, parse,
    };

    fn frontmatter(text: &str) -> super::Frontmatter {
        parse(text).expect("parsable front matter")
    }

    fn scalar<'a>(source: &'a str, key: &str) -> (&'a str, ScalarStyle, String) {
        let fm = frontmatter(source);
        let entry = fm
            .entries_named(key)
            .next()
            .unwrap_or_else(|| panic!("missing key {key}"));
        match &entry.value {
            Value::Scalar {
                style,
                span,
                text: decoded,
            } => (&source[span.clone()], *style, decoded.clone()),
            other => panic!("expected a scalar for {key}, found {other:?}"),
        }
    }

    #[test]
    fn detects_line_endings_and_bom() {
        assert_eq!(frontmatter("---\na: 1\n---\n").line_ending, LineEnding::Lf);
        assert_eq!(
            frontmatter("---\r\na: 1\r\n---\r\n").line_ending,
            LineEnding::Crlf
        );
        assert!(!frontmatter("---\na: 1\n---\n").bom);

        let with_bom = frontmatter("\u{feff}---\na: 1\n---\n");
        assert!(with_bom.bom);
        assert_eq!(with_bom.entries.len(), 1);
    }

    #[test]
    fn records_exact_scalar_spans() {
        let source =
            "---\nplain: hello world  # note\nquoted: \"a \\\"b\\\"\"\nsingle: 'it''s'\n---\nbody";
        assert_eq!(
            scalar(source, "plain"),
            ("hello world", ScalarStyle::Plain, "hello world".to_owned())
        );
        assert_eq!(
            scalar(source, "quoted"),
            (
                "\"a \\\"b\\\"\"",
                ScalarStyle::DoubleQuoted,
                "a \"b\"".to_owned()
            )
        );
        assert_eq!(
            scalar(source, "single"),
            ("'it''s'", ScalarStyle::SingleQuoted, "it's".to_owned())
        );
    }

    #[test]
    fn keeps_comments_and_blank_lines_out_of_values() {
        let source = "---\n# leading\na: 1\n\n# between\nb: 2\n---\n";
        let fm = frontmatter(source);
        assert_eq!(fm.entries.len(), 2);
        assert!(matches!(fm.entries[0].value, Value::Scalar { .. }));
        assert!(matches!(fm.entries[1].value, Value::Scalar { .. }));
    }

    #[test]
    fn flags_unsupported_shapes() {
        let cases = [
            ("---\nk: |\n  line\n---\n", Unsupported::BlockScalar),
            ("---\nk: >-\n  line\n---\n", Unsupported::BlockScalar),
            ("---\nk: [a, b]\n---\n", Unsupported::FlowCollection),
            ("---\nk: {a: b}\n---\n", Unsupported::FlowCollection),
            ("---\nk: &anchor v\n---\n", Unsupported::AnchorAliasTag),
            ("---\nk: !!str v\n---\n", Unsupported::AnchorAliasTag),
            ("---\nk:\n  - a\n---\n", Unsupported::NestedBlock),
            ("---\nk:\n  nested: 1\n---\n", Unsupported::NestedBlock),
            (
                "---\nk: start\n  continued\n---\n",
                Unsupported::MultilineScalar,
            ),
            ("---\nk: \"unclosed\n---\n", Unsupported::MultilineScalar),
            ("---\nk: a: b\n---\n", Unsupported::Malformed),
            ("---\nk: \"closed\" trailing\n---\n", Unsupported::Malformed),
        ];
        for (source, expected) in cases {
            let fm = frontmatter(source);
            assert_eq!(
                fm.entries[0].value,
                Value::Unsupported(expected),
                "source: {source:?}"
            );
        }
    }

    #[test]
    fn rejects_documents_without_a_mapping_root() {
        assert!(matches!(
            parse("---\n- one\n- two\n---\n"),
            Err(FrontmatterError::NonMappingRoot { line: 2 })
        ));
        assert!(matches!(
            parse("---\njust text\n---\n"),
            Err(FrontmatterError::NonMappingRoot { line: 2 })
        ));
        assert!(matches!(
            parse("---\n  indented: 1\n---\n"),
            Err(FrontmatterError::NonMappingRoot { line: 2 })
        ));
        assert!(matches!(
            parse("---\n%YAML 1.2\n---\n"),
            Err(FrontmatterError::NonMappingRoot { line: 2 })
        ));
    }

    #[test]
    fn rejects_missing_and_unterminated_front_matter() {
        assert_eq!(parse("# just markdown\n"), Err(FrontmatterError::Missing));
        assert_eq!(parse(""), Err(FrontmatterError::Missing));
        assert_eq!(parse("---"), Err(FrontmatterError::Unterminated));
        assert_eq!(parse("---\na: 1\n"), Err(FrontmatterError::Unterminated));
        assert_eq!(
            parse("---\r\na: 1\r\n-- -\r\n"),
            Err(FrontmatterError::Unterminated)
        );
    }

    #[test]
    fn empty_values_expose_an_insertion_span() {
        let fm = frontmatter("---\na:\nb:   # why\n---\n");
        assert!(matches!(
            fm.entries[0].value,
            Value::Empty {
                comment_follows: false,
                ..
            }
        ));
        assert!(matches!(
            fm.entries[1].value,
            Value::Empty {
                comment_follows: true,
                ..
            }
        ));
    }

    #[test]
    fn quoted_keys_are_decoded() {
        let fm = frontmatter("---\n\"quoted key\": 1\n'other key': 2\n---\n");
        assert_eq!(fm.entries[0].key, "quoted key");
        assert_eq!(fm.entries[1].key, "other key");
    }

    #[test]
    fn encodes_plainly_when_it_is_safe() {
        assert_eq!(encode_scalar("Hello", None).unwrap(), "Hello");
        assert_eq!(
            encode_scalar("https://example.com/a?b=c#d", None).unwrap(),
            "https://example.com/a?b=c#d"
        );
        assert_eq!(
            encode_scalar("2026-01-01T00:00:00Z", None).unwrap(),
            "2026-01-01T00:00:00Z"
        );
    }

    #[test]
    fn quotes_anything_that_would_change_meaning() {
        for value in [
            "true",
            "false",
            "null",
            "~",
            "42",
            "3.14",
            "0x10",
            "",
            " lead",
            "trail ",
            "- dash",
            "a: b",
            "hash # here",
            "#comment",
            "[list]",
            "{map}",
            "yes",
        ] {
            let encoded = encode_scalar(value, None).unwrap();
            assert!(encoded.starts_with('"'), "{value:?} encoded as {encoded:?}");
        }
    }

    #[test]
    fn preserves_the_existing_style() {
        assert_eq!(
            encode_scalar("Hello", Some(ScalarStyle::DoubleQuoted)).unwrap(),
            "\"Hello\""
        );
        assert_eq!(
            encode_scalar("it's", Some(ScalarStyle::SingleQuoted)).unwrap(),
            "'it''s'"
        );
        // A plain field falls back to quoting when the new value needs it.
        assert_eq!(
            encode_scalar("true", Some(ScalarStyle::Plain)).unwrap(),
            "\"true\""
        );
    }

    #[test]
    fn refuses_values_that_cannot_live_on_one_line() {
        assert_eq!(encode_scalar("two\nlines", None), None);
        assert_eq!(encode_scalar("bell\u{7}", None), None);
    }

    #[test]
    fn recognises_null_tokens() {
        assert!(is_null_token("~"));
        assert!(is_null_token("null"));
        assert!(!is_null_token("nullish"));
    }
}
