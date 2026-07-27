//! The JSON shapes the HTTP API speaks.
//!
//! One type describes both bookmarks and folders, matching the `BookmarkNode`
//! the web UI already uses for the Chrome and Firefox adapters: a node with
//! `children` is a folder, a node with a `url` is a bookmark. Keeping the two
//! in one type is what lets the daemon adapter drop in beside the others.
//!
//! Optional fields are omitted rather than sent as `null`, so a response never
//! carries a key that means nothing.

use bbb_vault_core::{Access, BookmarkNode, Diagnostic, FolderNode, VaultScan};
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
}

/// The body of `POST /api/v1/folders`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CreateFolderRequest {
    /// The folder to create in.
    pub parent_id: String,
    /// The display title.
    pub title: String,
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
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MoveRequest {
    /// The revision the caller last saw.
    pub revision: String,
    /// The destination folder.
    pub parent_id: String,
}

/// The query string of the two `DELETE` routes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteQuery {
    /// The revision the caller last saw.
    pub revision: String,
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
        read_only: read_only_flag(node.access()),
        diagnostics: diagnostics_dto(node.diagnostics()),
    }
}

pub(crate) fn folder_dto(node: &FolderNode, parent: Option<EntryRef>) -> BookmarkDto {
    let own = folder_ref(node);
    let mut children: Vec<BookmarkDto> = node
        .folders()
        .iter()
        .map(|child| folder_dto(child, Some(own.clone())))
        .collect();
    children.extend(
        node.bookmarks()
            .iter()
            .map(|child| bookmark_dto(child, Some(own.clone()))),
    );

    BookmarkDto {
        id: own,
        title: node.title().to_owned(),
        url: None,
        parent_id: parent,
        children: Some(children),
        date_added: None,
        revision: node.revision().map(|revision| revision.to_string()),
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
