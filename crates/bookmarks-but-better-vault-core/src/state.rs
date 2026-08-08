//! The machine-managed child order of one folder: `.bookmarks-but-better-state.json`.
//!
//! The filesystem stays authoritative for *membership* — what is in a folder is
//! whatever the directory holds — and identity stays in front matter. This file
//! adds the one thing neither of those can express: the order the user chose,
//! across bookmarks and sub-folders together.
//!
//! ```json
//! {
//!   "version": 1,
//!   "children": [
//!     { "id": "a1b2c3d4", "kind": "bookmark", "addedAt": "2026-07-28T09:00:00Z" }
//!   ]
//! }
//! ```
//!
//! Position in `children` *is* the order. `addedAt` records when the entry
//! became a member of this parent, and is informational: nothing sorts by it.
//!
//! # It is machine-managed, and it is still user data
//!
//! The file lives in the user's vault, so it can be hand-edited, merged by a
//! sync client, or written by a different version of this program. Three rules
//! follow, and every one of them is about never destroying what the daemon
//! cannot understand:
//!
//! * A document this build cannot fully account for — an unknown key, a
//!   duplicated child, a version from the future, anything that is not the JSON
//!   above — is **never rewritten**. Where it can still be read it is still
//!   honoured for ordering; it simply stops being writable. See [`StateFreeze`].
//! * A duplicated *JSON key* is a hard parse error rather than a last-one-wins
//!   merge, because two values for one key have no correct interpretation.
//!   That is why this module deserialises through its own visitors instead of
//!   through [`serde_json::Value`], which keeps the last silently.
//! * A child the file names but the directory does not hold is kept, not
//!   pruned. A file that is missing right now is very often a file a sync
//!   client has not delivered yet.
//!
//! Rendering is canonical: two-space indentation, a trailing newline, and keys
//! in the order above, so a no-op rewrite is byte-identical and the file diffs
//! cleanly in Git.

use core::fmt;
use std::collections::HashSet;

use serde::de::{self, IgnoredAny, MapAccess, Visitor};
use serde::ser::{SerializeSeq as _, SerializeStruct as _};
use serde::{Deserializer, Serialize, Serializer};

use crate::id::Id;

/// The child-order file that lives in every managed folder.
///
/// The leading dot keeps it out of Obsidian's note list, and the `.json`
/// extension keeps it out of the Markdown scan, while leaving it in plain sight
/// for Git and for the user.
pub const STATE_FILE_NAME: &str = ".bookmarks-but-better-state.json";

/// The schema version this build writes and understands.
pub const STATE_VERSION: u64 = 1;

/// What kind of entry a state child refers to.
///
/// The kind is recorded rather than inferred so that a state file naming a
/// bookmark can be recognised as disagreeing with a directory of the same
/// identity, instead of quietly ordering the wrong thing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum ChildKind {
    /// A bookmark, one Markdown file.
    Bookmark,
    /// A folder, one directory.
    Folder,
}

impl ChildKind {
    /// The stable wire representation.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Bookmark => "bookmark",
            Self::Folder => "folder",
        }
    }

    /// Parses the wire representation.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "bookmark" => Some(Self::Bookmark),
            "folder" => Some(Self::Folder),
            _ => None,
        }
    }
}

impl fmt::Display for ChildKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One entry in a folder's recorded order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StateChild {
    id: Id,
    kind: ChildKind,
    added_at: String,
}

impl StateChild {
    /// Records `id` as a child of the folder, of `kind`, from `added_at`.
    #[must_use]
    pub fn new(id: Id, kind: ChildKind, added_at: impl Into<String>) -> Self {
        Self {
            id,
            kind,
            added_at: added_at.into(),
        }
    }

    /// The stable identity of the child.
    #[must_use]
    pub const fn id(&self) -> Id {
        self.id
    }

    /// Whether the child is a bookmark or a folder.
    #[must_use]
    pub const fn kind(&self) -> ChildKind {
        self.kind
    }

    /// When the child became a member of this parent, as RFC 3339 text.
    #[must_use]
    pub fn added_at(&self) -> &str {
        &self.added_at
    }
}

impl Serialize for StateChild {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut entry = serializer.serialize_struct("StateChild", 3)?;
        entry.serialize_field("id", self.id.as_str())?;
        entry.serialize_field("kind", self.kind.as_str())?;
        entry.serialize_field("addedAt", &self.added_at)?;
        entry.end()
    }
}

/// One folder's recorded child order.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FolderState {
    children: Vec<StateChild>,
}

impl FolderState {
    /// A state holding exactly `children`, in that order.
    #[must_use]
    pub const fn new(children: Vec<StateChild>) -> Self {
        Self { children }
    }

    /// The recorded children, in order.
    #[must_use]
    pub fn children(&self) -> &[StateChild] {
        &self.children
    }

    /// The canonical bytes for this state: pretty JSON with a final newline.
    ///
    /// Deterministic, so re-rendering an unchanged state produces the exact
    /// bytes already on disk and a write can be skipped entirely.
    #[must_use]
    pub fn render(&self) -> Vec<u8> {
        // A struct of a `u64` and owned strings cannot fail to serialise; the
        // fallback keeps the function total rather than panicking in a daemon.
        let mut bytes = serde_json::to_vec_pretty(&Document { state: self })
            .unwrap_or_else(|_| b"{\n  \"version\": 1,\n  \"children\": []\n}".to_vec());
        bytes.push(b'\n');
        bytes
    }

    /// Reads a state document.
    ///
    /// # Errors
    ///
    /// Returns [`StateError`] for anything that is not this schema, including a
    /// duplicated JSON key and a version this build does not understand.
    pub fn parse(bytes: &[u8]) -> Result<(Self, Option<StateFreeze>), StateError> {
        let document: RawDocument = serde_json::from_slice(bytes)
            .map_err(|error| StateError::Malformed(error.to_string()))?;

        if document.version != STATE_VERSION {
            return Err(StateError::UnsupportedVersion(document.version));
        }

        let mut freeze = document.unknown.then_some(StateFreeze::UnknownField);
        let mut seen = HashSet::new();
        let mut children = Vec::with_capacity(document.children.len());

        for raw in document.children {
            let id = Id::parse(&raw.id)
                .map_err(|error| StateError::Malformed(format!("`id`: {error}")))?;
            let kind = ChildKind::parse(&raw.kind).ok_or_else(|| {
                StateError::Malformed(format!("`kind` is `{}`, which is not a kind", raw.kind))
            })?;
            if raw.unknown {
                freeze = freeze.or(Some(StateFreeze::UnknownField));
            }
            if !seen.insert(id) {
                // Two positions for one identity have no correct reading, so
                // the first wins for display and the file is never rewritten.
                freeze = Some(StateFreeze::DuplicateChild);
                continue;
            }
            children.push(StateChild::new(id, kind, raw.added_at));
        }

        Ok((Self { children }, freeze))
    }
}

/// Why a readable state file must nevertheless never be rewritten.
///
/// Both cases hold something this build cannot reproduce, so writing canonical
/// bytes over them would silently discard it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateFreeze {
    /// The document holds a key this schema does not define.
    UnknownField,
    /// One identity appears more than once in `children`.
    DuplicateChild,
}

impl StateFreeze {
    /// A sentence for a diagnostic a person reads.
    #[must_use]
    pub const fn detail(self) -> &'static str {
        match self {
            Self::UnknownField => {
                "the child order file holds a key this version does not define — most likely \
                 written by a newer build. The order it records is still used, and the file is \
                 never rewritten, because rewriting it would discard that key. Entries can still \
                 be created, renamed, moved and deleted; only changing their order is refused, \
                 until the extra key is removed or this build is upgraded"
            }
            Self::DuplicateChild => {
                "the child order file names one entry more than once, which has no single correct \
                 reading. The first position is used and the file is never rewritten; remove the \
                 duplicate to make ordering writable again"
            }
        }
    }
}

/// Why a state document could not be read at all.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StateError {
    /// The bytes are not the JSON this schema defines.
    Malformed(String),
    /// The document declares a version this build does not understand.
    UnsupportedVersion(u64),
}

impl fmt::Display for StateError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed(reason) => write!(f, "the child order file is not readable: {reason}"),
            Self::UnsupportedVersion(version) => write!(
                f,
                "the child order file is version {version}, which this build does not understand"
            ),
        }
    }
}

impl core::error::Error for StateError {}

/// The serialised shape, kept private so the canonical rendering has one owner.
struct Document<'a> {
    state: &'a FolderState,
}

impl Serialize for Document<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut document = serializer.serialize_struct("FolderState", 2)?;
        document.serialize_field("version", &STATE_VERSION)?;
        document.serialize_field("children", &Children(self.state.children()))?;
        document.end()
    }
}

struct Children<'a>(&'a [StateChild]);

impl Serialize for Children<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut sequence = serializer.serialize_seq(Some(self.0.len()))?;
        for child in self.0 {
            sequence.serialize_element(child)?;
        }
        sequence.end()
    }
}

/// The document as it was written, before anything is interpreted.
struct RawDocument {
    version: u64,
    children: Vec<RawChild>,
    /// Whether a key outside this schema was present.
    unknown: bool,
}

struct RawChild {
    id: String,
    kind: String,
    added_at: String,
    /// Whether a key outside this schema was present.
    unknown: bool,
}

/// Records that `key` was seen, refusing a second sighting.
///
/// This is the whole reason the two visitors below are written out rather than
/// derived or routed through [`serde_json::Value`]. A derived `Deserialize`
/// rejects a repeated *known* key and would have to be told to reject an
/// unknown one, which would also reject the forward-compatible case this format
/// wants to survive; `Value` keeps the last value for any repeated key, turning
/// an ambiguous document into a confident wrong answer. Neither is acceptable
/// for a file that decides what order a user's bookmarks are in.
fn claim<E: de::Error>(seen: &mut HashSet<String>, key: &str) -> Result<(), E> {
    if seen.insert(key.to_owned()) {
        Ok(())
    } else {
        Err(de::Error::custom(format!("duplicate field `{key}`")))
    }
}

impl<'de> serde::Deserialize<'de> for RawDocument {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct DocumentVisitor;

        impl<'de> Visitor<'de> for DocumentVisitor {
            type Value = RawDocument;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a child order document")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut seen = HashSet::new();
                let mut version = None;
                let mut children = None;
                let mut unknown = false;

                while let Some(key) = map.next_key::<String>()? {
                    claim(&mut seen, &key)?;
                    match key.as_str() {
                        "version" => version = Some(map.next_value()?),
                        "children" => children = Some(map.next_value()?),
                        _ => {
                            unknown = true;
                            map.next_value::<IgnoredAny>()?;
                        }
                    }
                }

                Ok(RawDocument {
                    version: version.ok_or_else(|| de::Error::missing_field("version"))?,
                    children: children.ok_or_else(|| de::Error::missing_field("children"))?,
                    unknown,
                })
            }
        }

        deserializer.deserialize_map(DocumentVisitor)
    }
}

impl<'de> serde::Deserialize<'de> for RawChild {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ChildVisitor;

        impl<'de> Visitor<'de> for ChildVisitor {
            type Value = RawChild;

            fn expecting(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str("a child order entry")
            }

            fn visit_map<M: MapAccess<'de>>(self, mut map: M) -> Result<Self::Value, M::Error> {
                let mut seen = HashSet::new();
                let mut id = None;
                let mut kind = None;
                let mut added_at = None;
                let mut unknown = false;

                while let Some(key) = map.next_key::<String>()? {
                    claim(&mut seen, &key)?;
                    match key.as_str() {
                        "id" => id = Some(map.next_value()?),
                        "kind" => kind = Some(map.next_value()?),
                        "addedAt" => added_at = Some(map.next_value()?),
                        _ => {
                            unknown = true;
                            map.next_value::<IgnoredAny>()?;
                        }
                    }
                }

                Ok(RawChild {
                    id: id.ok_or_else(|| de::Error::missing_field("id"))?,
                    kind: kind.ok_or_else(|| de::Error::missing_field("kind"))?,
                    added_at: added_at.ok_or_else(|| de::Error::missing_field("addedAt"))?,
                    unknown,
                })
            }
        }

        deserializer.deserialize_map(ChildVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(text: &str) -> Id {
        Id::parse(text).expect("a valid id")
    }

    fn sample() -> FolderState {
        FolderState::new(vec![
            StateChild::new(id("a1b2c3d4"), ChildKind::Folder, "2026-01-01T00:00:00Z"),
            StateChild::new(id("e5f6a7b8"), ChildKind::Bookmark, "2026-01-02T00:00:00Z"),
        ])
    }

    /// Pins the exact bytes. A change here changes every state file in every
    /// vault, and turns a no-op reorder into a real write.
    #[test]
    fn the_canonical_rendering_is_pinned() {
        let expected = [
            "{",
            r#"  "version": 1,"#,
            r#"  "children": ["#,
            "    {",
            r#"      "id": "a1b2c3d4","#,
            r#"      "kind": "folder","#,
            r#"      "addedAt": "2026-01-01T00:00:00Z""#,
            "    },",
            "    {",
            r#"      "id": "e5f6a7b8","#,
            r#"      "kind": "bookmark","#,
            r#"      "addedAt": "2026-01-02T00:00:00Z""#,
            "    }",
            "  ]",
            "}",
            "",
        ]
        .join("\n");
        assert_eq!(
            String::from_utf8(sample().render()).expect("utf-8"),
            expected
        );
    }

    #[test]
    fn an_empty_state_renders_an_empty_list() {
        assert_eq!(
            String::from_utf8(FolderState::default().render()).expect("utf-8"),
            "{\n  \"version\": 1,\n  \"children\": []\n}\n"
        );
    }

    #[test]
    fn rendering_round_trips() {
        let (parsed, freeze) = FolderState::parse(&sample().render()).expect("parse");
        assert_eq!(parsed, sample());
        assert_eq!(freeze, None);
        assert_eq!(parsed.render(), sample().render());
    }

    #[test]
    fn a_duplicated_json_key_is_refused_rather_than_merged() {
        let bytes = br#"{"version":1,"version":1,"children":[]}"#;
        let error = FolderState::parse(bytes).expect_err("a repeated key is ambiguous");
        assert!(matches!(error, StateError::Malformed(_)), "{error:?}");
    }

    #[test]
    fn a_duplicated_unknown_json_key_is_refused_too() {
        let bytes = br#"{"version":1,"children":[],"extra":1,"extra":2}"#;
        let error = FolderState::parse(bytes).expect_err("a repeated key is ambiguous");
        assert!(matches!(error, StateError::Malformed(_)), "{error:?}");
    }

    #[test]
    fn an_unknown_field_is_readable_but_freezes_the_file() {
        let bytes = br#"{"version":1,"children":[],"pinned":["a1b2c3d4"]}"#;
        let (state, freeze) = FolderState::parse(bytes).expect("still readable");
        assert!(state.children().is_empty());
        assert_eq!(freeze, Some(StateFreeze::UnknownField));
    }

    #[test]
    fn an_unknown_field_inside_a_child_freezes_the_file() {
        let bytes = br#"{"version":1,"children":[
            {"id":"a1b2c3d4","kind":"folder","addedAt":"2026-01-01T00:00:00Z","note":"hi"}]}"#;
        let (state, freeze) = FolderState::parse(bytes).expect("still readable");
        assert_eq!(state.children().len(), 1);
        assert_eq!(freeze, Some(StateFreeze::UnknownField));
    }

    #[test]
    fn a_duplicated_child_keeps_the_first_and_freezes_the_file() {
        let bytes = br#"{"version":1,"children":[
            {"id":"a1b2c3d4","kind":"folder","addedAt":"2026-01-01T00:00:00Z"},
            {"id":"a1b2c3d4","kind":"bookmark","addedAt":"2026-01-02T00:00:00Z"}]}"#;
        let (state, freeze) = FolderState::parse(bytes).expect("still readable");
        assert_eq!(state.children().len(), 1);
        assert_eq!(state.children()[0].kind(), ChildKind::Folder);
        assert_eq!(freeze, Some(StateFreeze::DuplicateChild));
    }

    #[test]
    fn a_future_version_is_refused_by_version_rather_than_by_shape() {
        let error = FolderState::parse(br#"{"version":2,"children":[]}"#).expect_err("refused");
        assert_eq!(error, StateError::UnsupportedVersion(2));
    }

    #[test]
    fn malformed_documents_are_refused() {
        for bytes in [
            &b"{ not json"[..],
            br#"{"children":[]}"#,
            br#"{"version":1}"#,
            br#"{"version":1,"children":{}}"#,
            br#"{"version":1,"children":[{"id":"NOPE","kind":"folder","addedAt":"x"}]}"#,
            br#"{"version":1,"children":[{"id":"a1b2c3d4","kind":"widget","addedAt":"x"}]}"#,
            br#"{"version":1,"children":[{"id":"a1b2c3d4","kind":"folder"}]}"#,
            b"[]",
        ] {
            let outcome = FolderState::parse(bytes);
            assert!(
                outcome.is_err(),
                "{} must be refused",
                String::from_utf8_lossy(bytes)
            );
        }
    }

    #[test]
    fn kinds_round_trip() {
        for kind in [ChildKind::Bookmark, ChildKind::Folder] {
            assert_eq!(ChildKind::parse(kind.as_str()), Some(kind));
            assert_eq!(kind.to_string(), kind.as_str());
        }
        assert_eq!(ChildKind::parse("widget"), None);
    }
}
