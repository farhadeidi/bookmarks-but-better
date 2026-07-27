//! The JSON shapes the HTTP API speaks.
//!
//! One type describes both bookmarks and folders, matching the `BookmarkNode`
//! the web UI already uses for the Chrome and Firefox adapters: a node with
//! `children` is a folder, a node with a `url` is a bookmark. Keeping the two
//! in one type is what lets the daemon adapter drop in beside the others.
//!
//! Optional fields are omitted rather than sent as `null`, so a response never
//! carries a key that means nothing.

use bbb_vault_core::{Access, BookmarkNode, ChildNode, Diagnostic, FolderNode, VaultScan};
use serde::{Deserialize, Serialize};

use crate::clock;
use crate::entry::EntryRef;

/// One bookmark or folder as the API renders it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkDto {
    /// The stable identity, or a synthetic `!path` address for a directory
    /// that has none.
    pub id: EntryRef,
    /// The display title.
    pub title: String,
    /// The target URL; absent on folders.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// The containing folder; absent only on the vault root.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<EntryRef>,
    /// Child entries in deterministic display order; present only on folders.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<BookmarkDto>>,
    /// Creation time in milliseconds since the Unix epoch.
    ///
    /// The vault stores RFC 3339 text; this is the parsed form, and is omitted
    /// when the field is absent or unparseable. The bytes on disk are never
    /// rewritten to match.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_added: Option<i64>,
    /// The content revision to send back with the next mutation.
    ///
    /// Absent when there is nothing to write: a directory with no
    /// `.bbb-folder.md` has no revision to be stale against.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    /// The revision of the folder's child order file, to send back with the
    /// next change to what this folder holds or the order it holds it in.
    ///
    /// Absent on bookmarks, and on a folder that has no order file yet — in
    /// which case a request must send nothing rather than invent one, and the
    /// daemon writes the first one as part of the change.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state_revision: Option<String>,
    /// `true` when this folder's order file must not be rewritten, so
    /// positional requests against it are refused; omitted otherwise.
    ///
    /// Distinct from `readOnly`: the folder itself is perfectly writable, and
    /// entries can still be created, renamed and deleted inside it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub order_read_only: Option<bool>,
    /// `true` when the entry must not be written; omitted when it may be.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only: Option<bool>,
    /// Everything non-canonical about the entry; omitted when there is nothing.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub diagnostics: Option<Vec<DiagnosticDto>>,
}

/// One problem found while reading the vault.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticDto {
    /// The stable machine-readable classification.
    pub code: String,
    /// `error` (the entry is read-only) or `warning`.
    pub severity: String,
    /// A human-facing explanation.
    pub detail: String,
    /// The vault-relative path the problem is about.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The 1-based line, when the problem is inside a file.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

impl DiagnosticDto {
    pub(crate) fn from_core(diagnostic: &Diagnostic) -> Self {
        Self {
            code: diagnostic.code().as_str().to_owned(),
            severity: diagnostic.severity().as_str().to_owned(),
            detail: diagnostic.detail().to_owned(),
            path: diagnostic.path().map(str::to_owned),
            line: diagnostic.line(),
        }
    }
}

/// The body of `GET /api/v1/tree`.
#[derive(Debug, Clone, Serialize)]
pub struct TreeResponse {
    /// A single-element list holding the vault root and its whole subtree.
    ///
    /// It is a list because the web UI's adapter contract returns a list of
    /// roots, and because a future multi-vault mode would add entries here
    /// rather than change the shape.
    pub tree: Vec<BookmarkDto>,
}

/// The body of `GET /api/v1/health`.
#[derive(Debug, Clone, Serialize)]
pub struct HealthResponse {
    /// Always `ok` while the daemon is serving; the vault's own problems are
    /// reported in `warnings`, not by claiming the daemon is unhealthy.
    pub status: &'static str,
    /// The daemon's crate version.
    pub version: &'static str,
    /// The current vault generation; it changes whenever the tree changes.
    pub generation: u64,
    /// Every diagnostic in the vault, in display order.
    pub warnings: Vec<DiagnosticDto>,
}

/// The body of `POST /api/v1/rescan`.
#[derive(Debug, Clone, Serialize)]
pub struct RescanResponse {
    /// The generation after the rescan.
    pub generation: u64,
    /// Whether the rescan found anything different from the cached tree.
    pub changed: bool,
    /// Every diagnostic in the vault, in display order.
    pub warnings: Vec<DiagnosticDto>,
}

/// Where a new or moved entry goes, and the proof it may go there.
///
/// `parent_state_revision` is the caller's evidence that it was looking at the
/// folder's current order when it chose `index`. It is required exactly when
/// the folder has an order file: without it a stale UI could place an entry
/// third in a list that has since gained two more.
///
/// Not itself deserialised — `#[serde(flatten)]` and `deny_unknown_fields` are
/// mutually exclusive, and refusing a misspelled field matters more than
/// spelling these two out three times.
#[derive(Debug, Clone, Default)]
pub struct Placement {
    /// Where among the folder's children the entry goes, counted from zero.
    ///
    /// `None` means the end, which is what a client that does not care about
    /// order sends.
    pub index: Option<usize>,
    /// The revision of the destination folder's order file.
    pub parent_state_revision: Option<String>,
}

/// The body of `POST /api/v1/bookmarks`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateBookmarkRequest {
    /// The folder to create in.
    pub parent_id: String,
    /// The display title.
    pub title: String,
    /// The target URL. Omitting it creates a folder, matching the browser
    /// bookmark APIs the web UI is written against.
    #[serde(default)]
    pub url: Option<String>,
    /// Where among the parent's children to put it; the end when omitted.
    #[serde(default)]
    pub index: Option<usize>,
    /// The revision of the parent's order file, required once it has one.
    #[serde(default)]
    pub parent_state_revision: Option<String>,
}

/// The body of `POST /api/v1/folders`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateFolderRequest {
    /// The folder to create in.
    pub parent_id: String,
    /// The display title.
    pub title: String,
    /// Where among the parent's children to put it; the end when omitted.
    #[serde(default)]
    pub index: Option<usize>,
    /// The revision of the parent's order file, required once it has one.
    #[serde(default)]
    pub parent_state_revision: Option<String>,
}

/// The body of `PUT /api/v1/folders/:id/order`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrderRequest {
    /// The revision of the folder's order file, or absent when it has none.
    ///
    /// Absent is a claim in its own right — "this folder had no order file when
    /// I looked" — and is refused if one has appeared since.
    #[serde(default)]
    pub state_revision: Option<String>,
    /// Every direct child of the folder, in the order they should be in.
    ///
    /// This is a complete permutation, not a patch: a request that omits a
    /// child, invents one, or names one twice is refused rather than guessed
    /// at, because a partial order has no single correct completion.
    pub children: Vec<OrderChild>,
}

/// One entry in a requested child order.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OrderChild {
    /// The child's stable identity.
    pub id: String,
    /// Whether it is a `bookmark` or a `folder`.
    ///
    /// Sent, and checked, so that a client working from a stale tree cannot
    /// silently reorder a directory it believed was a bookmark.
    pub kind: String,
}

/// The body of `PATCH /api/v1/bookmarks/:id`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateRequest {
    /// The revision the caller last saw. A mismatch is a conflict, never an
    /// overwrite.
    pub revision: String,
    /// The new display title.
    #[serde(default)]
    pub title: Option<String>,
    /// The new target URL; refused on folders.
    #[serde(default)]
    pub url: Option<String>,
}

/// The body of `POST /api/v1/bookmarks/:id/move`.
///
/// A move changes two folders' membership, so it carries two order revisions.
/// A move *within* one folder is purely positional and carries one: send it as
/// either `sourceStateRevision` or `destinationStateRevision`, or as both with
/// the same value, since they name the same file.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveRequest {
    /// The revision the caller last saw.
    pub revision: String,
    /// The destination folder.
    pub parent_id: String,
    /// Where among the destination's children to put it; the end when omitted.
    #[serde(default)]
    pub index: Option<usize>,
    /// The revision of the order file of the folder the entry is leaving.
    #[serde(default)]
    pub source_state_revision: Option<String>,
    /// The revision of the order file of the folder the entry is joining.
    #[serde(default)]
    pub destination_state_revision: Option<String>,
}

/// The query string of the two `DELETE` routes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteQuery {
    /// The revision the caller last saw.
    pub revision: String,
    /// The revision of the parent folder's order file, required once it has
    /// one: removing an entry changes the recorded order too.
    #[serde(default)]
    pub parent_state_revision: Option<String>,
    /// Whether a folder that still has children may be deleted with them.
    ///
    /// Defaults to `false`: deleting a subtree is a separate, explicit request,
    /// not something a stale UI can do by accident.
    #[serde(default)]
    pub recursive: bool,
}

pub(crate) fn bookmark_dto(node: &BookmarkNode, parent: Option<EntryRef>) -> BookmarkDto {
    BookmarkDto {
        id: EntryRef::Identity(node.id()),
        title: node.title().to_owned(),
        url: node.url().map(str::to_owned),
        parent_id: parent,
        children: None,
        date_added: node.created().and_then(clock::epoch_millis),
        revision: Some(node.revision().to_string()),
        state_revision: None,
        order_read_only: None,
        read_only: read_only_flag(node.access()),
        diagnostics: diagnostics_dto(node.diagnostics()),
    }
}

pub(crate) fn folder_dto(node: &FolderNode, parent: Option<EntryRef>) -> BookmarkDto {
    let own = folder_ref(node);
    // One mixed list, in the order the scan resolved. Splitting it back into
    // folders-then-bookmarks here would throw away the ordering the whole
    // state file exists to record.
    let children: Vec<BookmarkDto> = node
        .children()
        .iter()
        .map(|child| match child {
            ChildNode::Folder(child) => folder_dto(child, Some(own.clone())),
            ChildNode::Bookmark(child) => bookmark_dto(child, Some(own.clone())),
        })
        .collect();

    BookmarkDto {
        id: own,
        title: node.title().to_owned(),
        url: None,
        parent_id: parent,
        children: Some(children),
        date_added: None,
        revision: node.revision().map(|revision| revision.to_string()),
        state_revision: node.state_revision().map(|revision| revision.to_string()),
        order_read_only: (!node.state_access().is_writable()).then_some(true),
        // A directory with no `.bbb-folder.md` is unwritable even though the
        // format core rates the missing file only a warning. The core is right
        // about the *file* — nothing is corrupt — but the API cannot offer a
        // write it has no stable address for, so it says so here rather than
        // letting a client discover it from a 422 later.
        read_only: read_only_flag(node.access()).or_else(|| node.id().is_none().then_some(true)),
        diagnostics: diagnostics_dto(node.diagnostics()),
    }
}

/// The address of a folder: its identity, or its path when it has none.
pub(crate) fn folder_ref(node: &FolderNode) -> EntryRef {
    node.id().map_or_else(
        || EntryRef::synthetic(node.relative_path()),
        EntryRef::Identity,
    )
}

pub(crate) fn tree(scan: &VaultScan) -> TreeResponse {
    TreeResponse {
        tree: vec![folder_dto(scan.folder(), None)],
    }
}

pub(crate) fn warnings(scan: &VaultScan) -> Vec<DiagnosticDto> {
    scan.diagnostics()
        .into_iter()
        .map(DiagnosticDto::from_core)
        .collect()
}

const fn read_only_flag(access: Access) -> Option<bool> {
    match access {
        Access::ReadOnly => Some(true),
        Access::ReadWrite => None,
    }
}

fn diagnostics_dto(diagnostics: &[Diagnostic]) -> Option<Vec<DiagnosticDto>> {
    if diagnostics.is_empty() {
        return None;
    }
    Some(diagnostics.iter().map(DiagnosticDto::from_core).collect())
}
