//! Deterministic, symlink-free traversal of a vault directory tree.
//!
//! The scan is the authoritative view of a vault: watchers and caches are only
//! ever hints, and a rescan must always be able to rebuild the same tree from
//! the same bytes. Two runs over identical content therefore produce identical
//! output, including the order of siblings and of diagnostics.
//!
//! # Where the order comes from
//!
//! A folder's children are one mixed list ([`ChildNode`]), because a user who
//! drags a bookmark above a sub-folder means exactly that and two per-kind
//! lists cannot express it. Their order is:
//!
//! * the order recorded in the folder's `.bbb-state.json`, for every child that
//!   file names and the directory actually holds; then
//! * every remaining child, in the deterministic *migration order* — folders
//!   first, then by `bbb_created` and stable identity.
//!
//! Membership stays the filesystem's business. The state file only ever says
//! what order things are in; it can never add a child that is not there, and a
//! child it does not mention still appears.
//!
//! # Not following symlinks, safely
//!
//! "Do not follow symlinks" cannot be implemented by checking a path and then
//! opening it: between the check and the open, anything may replace the name
//! with a link, and the open follows it. That window is the classic TOCTOU
//! race, and on a directory a user syncs with third-party tools it is not
//! theoretical.
//!
//! So the walk never names a path twice. It holds a directory *handle* and
//! resolves each child relative to that handle with the no-follow flag set
//! ([`cap_std`] and [`cap_fs_ext`], which use `openat`/`O_NOFOLLOW` on Unix and
//! the reparse-point equivalent on Windows). The handle that is checked is the
//! handle that is read; there is no name to swap in between. Sizes come from
//! `fstat` on the same open handle, and the read is bounded by the handle
//! itself rather than by a previously observed length.

use std::collections::HashMap;
use std::io::{self, Read as _};
use std::path::{Component, Path, PathBuf};

use cap_fs_ext::{DirExt as _, FollowSymlinks, OpenOptionsFollowExt as _};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};

use crate::diagnostic::{Diagnostic, DiagnosticCode};
use crate::document::{Access, BookmarkFile, FolderFile, ParseError};
use crate::id::Id;
use crate::naming::{fold_key, is_reserved_stem, parse_bookmark_file_name};
use crate::revision::Revision;
use crate::state::{ChildKind, FolderState, STATE_FILE_NAME, StateError};
use crate::timestamp::is_rfc3339;

/// The metadata file that gives a directory its stable identity.
///
/// The leading dot keeps it out of Obsidian's note list while leaving it in
/// plain sight for Git and for the user.
pub const FOLDER_FILE_NAME: &str = ".bbb-folder.md";

/// The suffix of a directory holding a bookmark's local assets.
const ASSETS_SUFFIX: &str = ".assets";

/// Limits applied while walking a vault.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScanOptions {
    max_depth: usize,
    max_file_bytes: u64,
}

impl Default for ScanOptions {
    fn default() -> Self {
        Self {
            max_depth: 64,
            max_file_bytes: 4 * 1024 * 1024,
        }
    }
}

impl ScanOptions {
    /// The default limits.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Sets how many directory levels below the root are visited.
    #[must_use]
    pub const fn with_max_depth(mut self, depth: usize) -> Self {
        self.max_depth = depth;
        self
    }

    /// Sets the largest Markdown file that will be parsed.
    #[must_use]
    pub const fn with_max_file_bytes(mut self, bytes: u64) -> Self {
        self.max_file_bytes = bytes;
        self
    }
}

/// One bookmark found on disk.
#[derive(Debug, Clone)]
pub struct BookmarkNode {
    path: PathBuf,
    relative_path: String,
    file_name: String,
    id: Id,
    title: String,
    url: Option<String>,
    created: Option<String>,
    updated: Option<String>,
    logo: Option<String>,
    revision: Revision,
    access: Access,
    diagnostics: Vec<Diagnostic>,
}

impl BookmarkNode {
    /// The absolute path of the Markdown file.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The vault-relative, `/`-separated path.
    #[must_use]
    pub fn relative_path(&self) -> &str {
        &self.relative_path
    }

    /// The on-disk filename.
    #[must_use]
    pub fn file_name(&self) -> &str {
        &self.file_name
    }

    /// The stable identity, which never depends on the path.
    #[must_use]
    pub const fn id(&self) -> Id {
        self.id
    }

    /// The display title: `bbb_title`, or the readable part of the filename.
    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    /// The target URL, absent only on a read-only bookmark.
    #[must_use]
    pub fn url(&self) -> Option<&str> {
        self.url.as_deref()
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

    /// The content revision of the file as it was read.
    #[must_use]
    pub const fn revision(&self) -> Revision {
        self.revision
    }

    /// Whether the bookmark may be written to.
    #[must_use]
    pub const fn access(&self) -> Access {
        self.access
    }

    /// Everything that is not canonical about this bookmark.
    #[must_use]
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }
}

/// One child of a folder, in the folder's display order.
///
/// Order is a property of the *folder*, not of the two kinds separately: a user
/// who drags a bookmark above a sub-folder means exactly that. So the scan
/// produces one mixed list, and the per-kind views below are filters over it
/// rather than the storage.
#[derive(Debug, Clone)]
pub enum ChildNode {
    /// A sub-folder.
    Folder(FolderNode),
    /// A bookmark.
    Bookmark(BookmarkNode),
}

impl ChildNode {
    /// The stable identity, absent only for a directory with no metadata.
    #[must_use]
    pub const fn id(&self) -> Option<Id> {
        match self {
            Self::Folder(node) => node.id(),
            Self::Bookmark(node) => Some(node.id()),
        }
    }

    /// Which kind of entry this is.
    #[must_use]
    pub const fn kind(&self) -> ChildKind {
        match self {
            Self::Folder(_) => ChildKind::Folder,
            Self::Bookmark(_) => ChildKind::Bookmark,
        }
    }

    /// The display title.
    #[must_use]
    pub fn title(&self) -> &str {
        match self {
            Self::Folder(node) => node.title(),
            Self::Bookmark(node) => node.title(),
        }
    }

    /// The vault-relative, `/`-separated path.
    #[must_use]
    pub fn relative_path(&self) -> &str {
        match self {
            Self::Folder(node) => node.relative_path(),
            Self::Bookmark(node) => node.relative_path(),
        }
    }

    /// The sub-folder, when this child is one.
    #[must_use]
    pub const fn as_folder(&self) -> Option<&FolderNode> {
        match self {
            Self::Folder(node) => Some(node),
            Self::Bookmark(_) => None,
        }
    }

    /// The bookmark, when this child is one.
    #[must_use]
    pub const fn as_bookmark(&self) -> Option<&BookmarkNode> {
        match self {
            Self::Bookmark(node) => Some(node),
            Self::Folder(_) => None,
        }
    }
}

/// Whether a folder's recorded child order may be rewritten.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StateAccess {
    /// The folder has no `.bbb-state.json` yet, so one is written the first
    /// time an ordering change needs it.
    Absent,
    /// The state is canonical and may be rewritten.
    ReadWrite,
    /// The state holds something this build cannot reproduce, so it is honoured
    /// for ordering as far as it can be read and never written back.
    ReadOnly,
}

impl StateAccess {
    /// A stable machine-readable name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Absent => "absent",
            Self::ReadWrite => "read_write",
            Self::ReadOnly => "read_only",
        }
    }

    /// Whether an ordering change may write this folder's state.
    #[must_use]
    pub const fn is_writable(self) -> bool {
        matches!(self, Self::Absent | Self::ReadWrite)
    }
}

/// One directory found on disk.
#[derive(Debug, Clone)]
pub struct FolderNode {
    path: PathBuf,
    relative_path: String,
    directory_name: String,
    id: Option<Id>,
    title: String,
    revision: Option<Revision>,
    access: Access,
    diagnostics: Vec<Diagnostic>,
    children: Vec<ChildNode>,
    state_revision: Option<Revision>,
    state_access: StateAccess,
}

impl FolderNode {
    /// The absolute path of the directory.
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The vault-relative, `/`-separated path; empty for the vault root.
    #[must_use]
    pub fn relative_path(&self) -> &str {
        &self.relative_path
    }

    /// The on-disk directory name.
    #[must_use]
    pub fn directory_name(&self) -> &str {
        &self.directory_name
    }

    /// The stable identity, absent when the directory has no usable
    /// `.bbb-folder.md`.
    #[must_use]
    pub const fn id(&self) -> Option<Id> {
        self.id
    }

    /// The display title: `bbb_title`, or the directory name.
    #[must_use]
    pub fn title(&self) -> &str {
        &self.title
    }

    /// The content revision of `.bbb-folder.md`, when it exists.
    #[must_use]
    pub const fn revision(&self) -> Option<Revision> {
        self.revision
    }

    /// Whether the folder metadata may be written to.
    #[must_use]
    pub const fn access(&self) -> Access {
        self.access
    }

    /// Everything that is not canonical about this directory.
    #[must_use]
    pub fn diagnostics(&self) -> &[Diagnostic] {
        &self.diagnostics
    }

    /// Every child, bookmarks and sub-folders together, in display order.
    ///
    /// This is the authoritative order: the recorded one where the folder has a
    /// usable `.bbb-state.json`, and the deterministic migration order where it
    /// does not. See [`scan`].
    #[must_use]
    pub fn children(&self) -> &[ChildNode] {
        &self.children
    }

    /// Child directories, in display order.
    pub fn folders(&self) -> impl Iterator<Item = &FolderNode> {
        self.children.iter().filter_map(ChildNode::as_folder)
    }

    /// Child bookmarks, in display order.
    pub fn bookmarks(&self) -> impl Iterator<Item = &BookmarkNode> {
        self.children.iter().filter_map(ChildNode::as_bookmark)
    }

    /// The content revision of `.bbb-state.json`, when it exists and is
    /// readable.
    ///
    /// This is what an ordering request carries back, and what makes a
    /// concurrent reorder a conflict rather than a silent overwrite.
    #[must_use]
    pub const fn state_revision(&self) -> Option<Revision> {
        self.state_revision
    }

    /// Whether the recorded child order may be rewritten.
    #[must_use]
    pub const fn state_access(&self) -> StateAccess {
        self.state_access
    }
}

/// The result of walking a vault.
#[derive(Debug, Clone)]
pub struct VaultScan {
    root: PathBuf,
    folder: FolderNode,
}

impl VaultScan {
    /// The absolute path the scan started from.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The root folder of the tree.
    #[must_use]
    pub const fn folder(&self) -> &FolderNode {
        &self.folder
    }

    /// Every bookmark in the vault, in display order.
    pub fn bookmarks(&self) -> impl Iterator<Item = &BookmarkNode> {
        let mut out = Vec::new();
        collect_bookmarks(&self.folder, &mut out);
        out.into_iter()
    }

    /// Every diagnostic in the vault, in display order.
    #[must_use]
    pub fn diagnostics(&self) -> Vec<&Diagnostic> {
        let mut out = Vec::new();
        collect_diagnostics(&self.folder, &mut out);
        out
    }

    /// Finds the one bookmark with `id`, wherever it currently lives.
    ///
    /// Returns `None` when no bookmark claims the identity **and** when more
    /// than one does. An ambiguous identity has no correct answer, and a lookup
    /// that guessed would let a write land on whichever copy happened to sort
    /// first. Use [`VaultScan::bookmarks_claiming`] to show the user the
    /// conflict.
    #[must_use]
    pub fn find_bookmark(&self, id: Id) -> Option<&BookmarkNode> {
        let mut claimants = self.bookmarks_claiming(id).into_iter();
        let first = claimants.next()?;
        claimants.next().is_none().then_some(first)
    }

    /// Every bookmark claiming `id`, in display order.
    ///
    /// More than one means the vault is ambiguous; all of them are read-only.
    #[must_use]
    pub fn bookmarks_claiming(&self, id: Id) -> Vec<&BookmarkNode> {
        self.bookmarks()
            .filter(|bookmark| bookmark.id == id)
            .collect()
    }

    /// Finds the one folder with `id`, with the same refusal to guess.
    #[must_use]
    pub fn find_folder(&self, id: Id) -> Option<&FolderNode> {
        let mut claimants = self.folders_claiming(id).into_iter();
        let first = claimants.next()?;
        claimants.next().is_none().then_some(first)
    }

    /// Every folder claiming `id`, in display order.
    #[must_use]
    pub fn folders_claiming(&self, id: Id) -> Vec<&FolderNode> {
        let mut out = Vec::new();
        collect_folders(&self.folder, &mut out);
        out.retain(|folder| folder.id == Some(id));
        out
    }
}

fn collect_folders<'a>(folder: &'a FolderNode, out: &mut Vec<&'a FolderNode>) {
    out.push(folder);
    for child in folder.folders() {
        collect_folders(child, out);
    }
}

fn collect_bookmarks<'a>(folder: &'a FolderNode, out: &mut Vec<&'a BookmarkNode>) {
    for child in folder.folders() {
        collect_bookmarks(child, out);
    }
    out.extend(folder.bookmarks());
}

fn collect_diagnostics<'a>(folder: &'a FolderNode, out: &mut Vec<&'a Diagnostic>) {
    out.extend(folder.diagnostics.iter());
    for child in folder.folders() {
        collect_diagnostics(child, out);
    }
    for bookmark in folder.bookmarks() {
        out.extend(bookmark.diagnostics.iter());
    }
}

/// Walks `root` with the default limits.
///
/// # Errors
///
/// Returns an error when the root itself cannot be read, and when the root is a
/// symbolic link or a Windows reparse point: a vault must be a real directory
/// that the user chose, not an indirection into one.
///
/// Problems with individual files inside the vault become diagnostics, so that
/// one broken note never hides the rest.
pub fn scan(root: &Path) -> io::Result<VaultScan> {
    scan_with(root, ScanOptions::default())
}

/// Walks `root` with explicit limits.
///
/// # Errors
///
/// As [`scan`].
pub fn scan_with(root: &Path, options: ScanOptions) -> io::Result<VaultScan> {
    let handle = open_vault_root(root)?;
    let mut folder = walk(&handle, root, String::new(), 0, options)?;
    resolve_duplicate_ids(&mut folder);
    Ok(VaultScan {
        root: root.to_path_buf(),
        folder,
    })
}

/// Opens the vault root, refusing a root that is itself a link.
///
/// The final path component decides how this can be done safely.
///
/// When it is an ordinary *name* — `/srv/vault`, `../vault`, or a bare `vault` —
/// that name is a directory entry someone could replace with a link, so it is
/// never opened by path. The directory holding it is opened first, and the name
/// is then resolved against that handle with the no-follow flag. There is no
/// window between deciding the root is a real directory and opening it: the
/// kernel refuses the link at the `openat` itself. A bare relative name has an
/// empty parent, which means the working directory, so `.` is the handle it is
/// resolved against.
///
/// When the final component is not a name — a filesystem root such as `/` or
/// `C:\`, or a `.` or `..` that ends the path — there is no directory entry to
/// substitute anything for, and the path is opened directly. This is not a
/// weaker check; it is the absence of anything to check.
fn open_vault_root(root: &Path) -> io::Result<Dir> {
    let authority = ambient_authority();

    let Some(Component::Normal(name)) = root.components().next_back() else {
        return Dir::open_ambient_dir(root, authority);
    };

    // `Path::parent` yields an empty path for a bare relative name; the
    // directory that holds it is the working directory.
    let parent = match root.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };

    Dir::open_ambient_dir(parent, authority)?
        .open_dir_nofollow(name)
        .map_err(|error| {
            io::Error::new(
                error.kind(),
                format!(
                    "the vault root {} could not be opened as a real directory \
                     (symbolic links and reparse points are refused): {error}",
                    root.display()
                ),
            )
        })
}

/// What a single directory contributes to the tree while it is being built.
#[derive(Debug, Default)]
struct Contents {
    diagnostics: Vec<Diagnostic>,
    folders: Vec<FolderNode>,
    bookmarks: Vec<BookmarkNode>,
    metadata: Option<FolderMetadata>,
    /// The folder's recorded child order, as it was found on disk.
    state: Option<StateFile>,
    /// Every child name that competes for a slot in this directory, used for the
    /// portability checks.
    sibling_names: Vec<String>,
}

#[derive(Debug)]
struct FolderMetadata {
    id: Id,
    title: Option<String>,
    revision: Revision,
    diagnostics: Vec<Diagnostic>,
}

/// The `.bbb-state.json` a directory holds, however usable it turned out to be.
#[derive(Debug)]
struct StateFile {
    /// The recorded order, absent when the file could not be read at all.
    state: Option<FolderState>,
    /// The revision of the bytes, absent when they could not be read.
    revision: Option<Revision>,
    /// Set when the file must never be rewritten.
    frozen: bool,
    /// What was wrong with it, if anything.
    diagnostics: Vec<Diagnostic>,
}

fn walk(
    handle: &Dir,
    path: &Path,
    relative_path: String,
    depth: usize,
    options: ScanOptions,
) -> io::Result<FolderNode> {
    let directory_name = path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    );

    let mut contents = Contents::default();
    // A sibling that folds to the order file's name without being it. The two
    // coexist here and are one file on macOS and Windows, so an order file
    // written now would not survive the vault being copied there. Recorded and
    // applied after the walk, so it wins over whatever was read.
    let mut folded_collision: Option<String> = None;

    for (name, file_type) in read_children(handle, &relative_path, &mut contents)? {
        let child_relative = join_relative(&relative_path, &name);
        if name != STATE_FILE_NAME && fold_key(&name) == fold_key(STATE_FILE_NAME) {
            folded_collision = Some(name.clone());
        }
        if let Some(state) = occupied_state(&name, file_type, &child_relative) {
            contents.state = Some(state);
            continue;
        }
        if file_type.is_symlink() {
            contents.diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::SymlinkSkipped,
                    "symbolic links are not followed",
                )
                .at_path(&child_relative),
            );
        } else if file_type.is_dir() {
            visit_directory(
                handle,
                &mut contents,
                &name,
                path,
                &child_relative,
                depth,
                options,
            );
        } else if file_type.is_file() {
            visit_file(handle, &mut contents, name, path, child_relative, options);
        }
    }

    contents.diagnostics.extend(portability_diagnostics(
        &contents.sibling_names,
        &relative_path,
    ));

    let mut diagnostics = contents.diagnostics;
    let metadata = contents.metadata.map_or_else(
        || {
            diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::MissingFolderMetadata,
                    format!(
                        "the directory has no `{FOLDER_FILE_NAME}`, so it has no stable identity"
                    ),
                )
                .at_path(display_path(&relative_path)),
            );
            None
        },
        Some,
    );
    if let Some(metadata) = &metadata {
        diagnostics.extend(metadata.diagnostics.iter().cloned());
    }

    let state = folded_collision.map_or(contents.state, |other| {
        Some(unreadable_state(
            &join_relative(&relative_path, STATE_FILE_NAME),
            &format!(
                "`{other}` differs from the child order file's name only by case, so the two \
                 would be one file on macOS and Windows; no order is read or written here until \
                 one of them is renamed"
            ),
        ))
    });
    if let Some(state) = &state {
        diagnostics.extend(state.diagnostics.iter().cloned());
    }

    let mut disorderly = false;
    let children = order_children(
        contents.folders,
        contents.bookmarks,
        state.as_ref().and_then(|state| state.state.as_ref()),
        &relative_path,
        &mut diagnostics,
        &mut disorderly,
    );
    let state_access = state_access_of(state.as_ref(), disorderly);

    Ok(FolderNode {
        path: path.to_path_buf(),
        title: metadata
            .as_ref()
            .and_then(|metadata| metadata.title.clone())
            .unwrap_or_else(|| directory_name.clone()),
        relative_path,
        directory_name,
        id: metadata.as_ref().map(|metadata| metadata.id),
        revision: metadata.as_ref().map(|metadata| metadata.revision),
        access: access_of(&diagnostics),
        diagnostics,
        children,
        state_revision: state.as_ref().and_then(|state| state.revision),
        state_access,
    })
}

/// Puts one directory's children into the order the vault says they are in.
///
/// Three rules, in this order, and each of them is about not losing anything:
///
/// * Children the state names, in the order it names them. That is the whole
///   point of the file.
/// * Children on disk the state does not name, appended in migration order.
///   The filesystem is authoritative for membership, so a file dropped into the
///   folder by any other tool shows up — after everything already placed, so it
///   cannot disturb an order the user chose.
/// * Children the state names that are not on disk are skipped, with a warning.
///   They are not pruned from the file: a bookmark that is missing right now is
///   very often one a sync client has not delivered yet.
///
/// `disorderly` is set when the state disagrees with the disk about a child's
/// kind, which is one of the conditions that makes the file unwritable.
fn order_children(
    folders: Vec<FolderNode>,
    bookmarks: Vec<BookmarkNode>,
    state: Option<&FolderState>,
    relative_path: &str,
    diagnostics: &mut Vec<Diagnostic>,
    disorderly: &mut bool,
) -> Vec<ChildNode> {
    let mut available: Vec<Option<ChildNode>> = folders
        .into_iter()
        .map(ChildNode::Folder)
        .chain(bookmarks.into_iter().map(ChildNode::Bookmark))
        .map(Some)
        .collect();
    available
        .sort_by_cached_key(|child| migration_key(child.as_ref().expect("every slot is filled")));

    let Some(state) = state else {
        return available.into_iter().flatten().collect();
    };

    // An identity two entries on disk both claim has no single answer, so the
    // state cannot place either of them; both fall through to the appended
    // group, where their order comes from the deterministic migration key. The
    // duplicate itself is already reported as an error elsewhere.
    let mut by_id: HashMap<Id, Option<usize>> = HashMap::new();
    for (index, child) in available.iter().enumerate() {
        if let Some(id) = child.as_ref().and_then(ChildNode::id) {
            by_id
                .entry(id)
                .and_modify(|slot| *slot = None)
                .or_insert(Some(index));
        }
    }

    let mut ordered = Vec::with_capacity(available.len());
    for listed in state.children() {
        let Some(Some(index)) = by_id.get(&listed.id()).copied() else {
            diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::StateMissingChild,
                    format!(
                        "the child order names `{}`, which this folder does not hold; it is kept \
                         in the file in case it comes back",
                        listed.id()
                    ),
                )
                .at_path(display_path(relative_path)),
            );
            continue;
        };
        let Some(child) = available[index].take() else {
            // Already placed: the duplicate case, which parsing reported.
            continue;
        };
        if child.kind() != listed.kind() {
            diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::StateWrongKind,
                    format!(
                        "the child order calls `{}` a {} and this folder holds a {}; the entry is \
                         shown in migration order and the file is not rewritten",
                        listed.id(),
                        listed.kind(),
                        child.kind()
                    ),
                )
                .at_path(display_path(relative_path)),
            );
            *disorderly = true;
            available[index] = Some(child);
            continue;
        }
        ordered.push(child);
    }

    ordered.extend(available.into_iter().flatten());
    ordered
}

/// The order a folder with no usable recorded order is shown in.
///
/// Folders come before bookmarks, matching the vault's long-standing sibling
/// order. Within each group the key is the creation timestamp the entry itself
/// carries — the only evidence of intent that survives a directory being copied
/// around — and then the stable identity, so the result never depends on the
/// filesystem's listing order, the platform, or the title.
///
/// The timestamp is compared as text, and only when it is valid RFC 3339. That
/// is chronological for the `Z` form this vault writes, and merely stable for a
/// hand-written offset; stable is what determinism needs.
fn migration_key(child: &ChildNode) -> (u8, u8, bool, String, String, String) {
    let (rank, created) = match child {
        ChildNode::Folder(_) => (0, None),
        ChildNode::Bookmark(node) => (1, node.created().filter(|text| is_rfc3339(text))),
    };
    (
        // A directory with no `.bbb-folder.md` has no identity, so no order
        // file can ever name it and nothing can move it. Sorting those into a
        // trailing block of their own is what makes their position *stable*:
        // it is the same before any order file exists and after every rewrite,
        // so managed entries reorder above them without shifting them, and an
        // index into the list a client is looking at means what it says.
        u8::from(child.id().is_none()),
        rank,
        created.is_none(),
        created.unwrap_or_default().to_owned(),
        child
            .id()
            .map_or_else(String::new, |id| id.as_str().to_owned()),
        child.relative_path().to_owned(),
    )
}

/// Whether a folder's recorded order may be rewritten.
fn state_access_of(state: Option<&StateFile>, disorderly: bool) -> StateAccess {
    match state {
        None => StateAccess::Absent,
        Some(state) if state.frozen || disorderly || state.revision.is_none() => {
            StateAccess::ReadOnly
        }
        Some(_) => StateAccess::ReadWrite,
    }
}

/// Reports a child order file's name being held by something unreadable.
///
/// A link, a directory, a socket: none of them is a document, and none of them
/// may be written through or over. The folder keeps its migration order and
/// stops being orderable until a person moves the occupant out of the way —
/// which is a clear refusal, rather than a write that would either fail
/// obscurely or clobber something.
fn occupied_state(
    name: &str,
    file_type: cap_std::fs::FileType,
    relative_path: &str,
) -> Option<StateFile> {
    if name != STATE_FILE_NAME || file_type.is_file() {
        return None;
    }
    let detail = if file_type.is_symlink() {
        "the child order file is a symbolic link, which is never followed or written through"
    } else if file_type.is_dir() {
        "a directory occupies the child order file's name, so no order can be read or written here"
    } else {
        "the child order file's name is held by something that is not a regular file, so no order \
         can be read or written here"
    };
    Some(unreadable_state(relative_path, detail))
}

/// A state file that exists and cannot be read, for whatever reason.
fn unreadable_state(relative_path: &str, detail: &str) -> StateFile {
    StateFile {
        state: None,
        revision: None,
        frozen: true,
        diagnostics: vec![
            Diagnostic::new(DiagnosticCode::StateUnreadable, detail.to_owned())
                .at_path(relative_path),
        ],
    }
}

/// Interprets the bytes of one `.bbb-state.json`.
fn read_state(bytes: &[u8], relative_path: &str) -> StateFile {
    let revision = Revision::of(bytes);
    match FolderState::parse(bytes) {
        Ok((state, freeze)) => StateFile {
            state: Some(state),
            revision: Some(revision),
            frozen: freeze.is_some(),
            diagnostics: freeze
                .map(|freeze| {
                    Diagnostic::new(DiagnosticCode::StateNotRewritable, freeze.detail())
                        .at_path(relative_path)
                })
                .into_iter()
                .collect(),
        },
        Err(error) => {
            let code = match error {
                StateError::Malformed(_) => DiagnosticCode::StateMalformed,
                StateError::UnsupportedVersion(_) => DiagnosticCode::StateUnsupportedVersion,
            };
            StateFile {
                state: None,
                // The bytes were read, so the revision is real; it is what a
                // client sends back once the file has been repaired.
                revision: Some(revision),
                frozen: true,
                diagnostics: vec![
                    Diagnostic::new(
                        code,
                        format!(
                            "{error}; this folder keeps its migration order and cannot be \
                             reordered until the file is fixed or removed"
                        ),
                    )
                    .at_path(relative_path),
                ],
            }
        }
    }
}

/// Lists a directory in a stable order.
///
/// `read_dir` order is filesystem-defined, so it is normalised here, before
/// anything that can emit a diagnostic runs. File types come from the directory
/// entry itself and describe the link, never its target.
fn read_children(
    handle: &Dir,
    relative_path: &str,
    contents: &mut Contents,
) -> io::Result<Vec<(String, cap_std::fs::FileType)>> {
    let mut children = Vec::new();
    for entry in handle.entries()? {
        let entry = entry?;
        let raw_name = entry.file_name();
        let Some(name) = raw_name.to_str() else {
            let lossy = raw_name.to_string_lossy();
            contents.diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::UnreadablePath,
                    format!(
                        "the name {lossy} is not valid UTF-8 and cannot be addressed by the vault"
                    ),
                )
                .at_path(join_relative(relative_path, &lossy)),
            );
            continue;
        };
        children.push((name.to_owned(), entry.file_type()?));
    }
    children.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(children)
}

fn visit_directory(
    handle: &Dir,
    contents: &mut Contents,
    name: &str,
    path: &Path,
    child_relative: &str,
    depth: usize,
    options: ScanOptions,
) {
    // Dot-directories belong to other tools, and `*.assets` holds a bookmark's
    // own files rather than more bookmarks.
    if name.starts_with('.') || name.ends_with(ASSETS_SUFFIX) {
        return;
    }
    contents.sibling_names.push(name.to_owned());

    if depth >= options.max_depth {
        contents.diagnostics.push(
            Diagnostic::new(
                DiagnosticCode::MaxDepthExceeded,
                format!(
                    "the vault is nested deeper than {} levels",
                    options.max_depth
                ),
            )
            .at_path(child_relative),
        );
        return;
    }

    // Re-resolving `name` against the handle with no-follow: if the entry became
    // a symlink since the listing, this fails rather than escaping the vault.
    let child_handle = match handle.open_dir_nofollow(name) {
        Ok(handle) => handle,
        Err(error) => {
            contents.diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::UnreadablePath,
                    format!("the directory could not be opened without following links: {error}"),
                )
                .at_path(child_relative),
            );
            return;
        }
    };

    match walk(
        &child_handle,
        &path.join(name),
        child_relative.to_owned(),
        depth + 1,
        options,
    ) {
        Ok(child) => contents.folders.push(child),
        Err(error) => contents.diagnostics.push(
            Diagnostic::new(
                DiagnosticCode::UnreadablePath,
                format!("the directory could not be read: {error}"),
            )
            .at_path(child_relative),
        ),
    }
}

fn visit_file(
    handle: &Dir,
    contents: &mut Contents,
    name: String,
    path: &Path,
    child_relative: String,
    options: ScanOptions,
) {
    let is_folder_file = name == FOLDER_FILE_NAME;
    let is_state_file = name == STATE_FILE_NAME;
    if !is_folder_file
        && !is_state_file
        && (name.starts_with('.') || !has_markdown_extension(&name))
    {
        return;
    }

    let bytes = match read_limited(handle, &name, options.max_file_bytes) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
            if is_state_file {
                // A child order file that big is not one this build wrote, so
                // it is left exactly as found rather than truncated or
                // replaced.
                contents.state = Some(unreadable_state(
                    &child_relative,
                    &format!(
                        "the child order file is larger than the {} byte limit and was not read",
                        options.max_file_bytes
                    ),
                ));
                return;
            }
            contents.diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::FileTooLarge,
                    format!(
                        "the file is larger than the {} byte limit and was not parsed",
                        options.max_file_bytes
                    ),
                )
                .at_path(&child_relative),
            );
            return;
        }
        Err(error) => {
            if is_state_file {
                contents.state = Some(unreadable_state(
                    &child_relative,
                    &format!("the child order file could not be read: {error}"),
                ));
                return;
            }
            contents.diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::UnreadablePath,
                    format!("the file could not be read without following links: {error}"),
                )
                .at_path(&child_relative),
            );
            return;
        }
    };

    if is_state_file {
        contents.state = Some(read_state(&bytes, &child_relative));
        return;
    }

    if is_folder_file {
        match FolderFile::parse_at(&bytes, Some(&child_relative)) {
            Ok(file) => {
                contents.metadata = Some(FolderMetadata {
                    id: file.id(),
                    title: file.title().map(str::to_owned),
                    revision: file.revision(),
                    diagnostics: file.diagnostics().to_vec(),
                });
            }
            Err(error) => contents
                .diagnostics
                .push(error.to_diagnostic(&child_relative)),
        }
        return;
    }

    contents.sibling_names.push(name.clone());
    match BookmarkFile::parse_at(&bytes, Some(&child_relative)) {
        Ok(file) => contents.bookmarks.push(build_bookmark(
            path.join(&name),
            child_relative,
            name,
            &file,
            Revision::of(&bytes),
        )),
        // A vault is a normal directory tree that also holds ordinary notes.
        // Markdown with no front matter, or with front matter that simply has
        // no `bbb_id`, is the user's own content and is passed over in silence.
        Err(ParseError::NotManaged | ParseError::MissingFrontmatter) => {}
        Err(error) => contents
            .diagnostics
            .push(error.to_diagnostic(&child_relative)),
    }
}

fn build_bookmark(
    path: PathBuf,
    relative_path: String,
    file_name: String,
    file: &BookmarkFile,
    revision: Revision,
) -> BookmarkNode {
    let parsed_name = parse_bookmark_file_name(&file_name);
    let mut diagnostics = file.diagnostics().to_vec();

    match parsed_name {
        Some((_, id)) if id == file.id() => {}
        _ => diagnostics.push(
            Diagnostic::new(
                DiagnosticCode::FilenameIdMismatch,
                format!(
                    "the filename does not end with `--{}`, so the identity is only recoverable \
                     from the front matter",
                    file.id()
                ),
            )
            .at_path(&relative_path),
        ),
    }

    let title = file.title().map_or_else(
        || parsed_name.map_or_else(|| file_name.clone(), |(base, _)| base.to_owned()),
        str::to_owned,
    );

    BookmarkNode {
        path,
        relative_path,
        file_name,
        id: file.id(),
        title,
        url: file.url().map(str::to_owned),
        created: file.created().map(str::to_owned),
        updated: file.updated().map(str::to_owned),
        logo: file.logo().map(str::to_owned),
        revision,
        access: access_of(&diagnostics),
        diagnostics,
    }
}

/// Warns about sibling names that would not survive a copy to another platform.
fn portability_diagnostics(names: &[String], relative_path: &str) -> Vec<Diagnostic> {
    let mut diagnostics = Vec::new();
    let mut seen: HashMap<String, &str> = HashMap::new();
    for name in names {
        if is_reserved_stem(name) {
            diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::NonPortableName,
                    format!("`{name}` is a reserved device name on Windows"),
                )
                .at_path(join_relative(relative_path, name)),
            );
        }
        if let Some(previous) = seen.insert(fold_key(name), name) {
            diagnostics.push(
                Diagnostic::new(
                    DiagnosticCode::NonPortableName,
                    format!(
                        "`{name}` and `{previous}` differ only by case and collide on macOS and \
                         Windows"
                    ),
                )
                .at_path(join_relative(relative_path, name)),
            );
        }
    }
    diagnostics
}

/// Marks **every** entry that shares an identity with another as read-only.
///
/// An earlier version kept the first claimant writable and demoted the rest.
/// That is wrong: nothing distinguishes the copy from the original, so "first in
/// traversal order" is an arbitrary winner, and a write aimed at the identity
/// would silently land on whichever file happened to sort first. When the vault
/// cannot say which entry an identity means, no entry may be written.
fn resolve_duplicate_ids(root: &mut FolderNode) {
    let mut claimants: HashMap<Id, Vec<String>> = HashMap::new();
    collect_claims(root, &mut claimants);
    claimants.retain(|_, paths| paths.len() > 1);
    if claimants.is_empty() {
        return;
    }
    for paths in claimants.values_mut() {
        paths.sort_unstable();
    }
    mark_claims(root, &claimants);
}

fn collect_claims(folder: &FolderNode, claimants: &mut HashMap<Id, Vec<String>>) {
    if let Some(id) = folder.id {
        claimants
            .entry(id)
            .or_default()
            .push(display_path(&folder.relative_path).to_owned());
    }
    for child in &folder.children {
        match child {
            ChildNode::Bookmark(bookmark) => claimants
                .entry(bookmark.id)
                .or_default()
                .push(bookmark.relative_path.clone()),
            ChildNode::Folder(nested) => collect_claims(nested, claimants),
        }
    }
}

fn mark_claims(folder: &mut FolderNode, claimants: &HashMap<Id, Vec<String>>) {
    if let Some(paths) = folder
        .id
        .and_then(|id| claimants.get(&id).map(|paths| (id, paths)))
    {
        let (id, paths) = paths;
        let own = display_path(&folder.relative_path).to_owned();
        folder.diagnostics.push(duplicate_id(id, paths, &own));
        folder.access = Access::ReadOnly;
    }
    for child in &mut folder.children {
        match child {
            ChildNode::Bookmark(bookmark) => {
                if let Some(paths) = claimants.get(&bookmark.id) {
                    let own = bookmark.relative_path.clone();
                    let diagnostic = duplicate_id(bookmark.id, paths, &own);
                    bookmark.diagnostics.push(diagnostic);
                    bookmark.access = Access::ReadOnly;
                }
            }
            ChildNode::Folder(nested) => mark_claims(nested, claimants),
        }
    }
}

fn duplicate_id(id: Id, claimants: &[String], own: &str) -> Diagnostic {
    let others: Vec<&str> = claimants
        .iter()
        .map(String::as_str)
        .filter(|path| *path != own)
        .collect();
    Diagnostic::new(
        DiagnosticCode::DuplicateId,
        format!(
            "the identity `{id}` is also claimed by `{}`; every entry claiming it is read-only \
             until exactly one keeps it",
            others.join("`, `")
        ),
    )
    .at_path(own)
}

fn access_of(diagnostics: &[Diagnostic]) -> Access {
    if diagnostics
        .iter()
        .any(|diagnostic| diagnostic.severity() == crate::diagnostic::Severity::Error)
    {
        Access::ReadOnly
    } else {
        Access::ReadWrite
    }
}

fn has_markdown_extension(name: &str) -> bool {
    Path::new(name)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

fn join_relative(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_owned()
    } else {
        format!("{parent}/{name}")
    }
}

fn display_path(relative_path: &str) -> &str {
    if relative_path.is_empty() {
        "."
    } else {
        relative_path
    }
}

/// Reads `name` from `handle` without following links, returning `None` when the
/// file exceeds `limit`.
///
/// The size limit is enforced by reading at most `limit + 1` bytes from the open
/// handle rather than by trusting a size observed beforehand: a file that grows
/// between the two is then bounded anyway, and there is no second path
/// resolution to race against.
fn read_limited(handle: &Dir, name: &str, limit: u64) -> io::Result<Option<Vec<u8>>> {
    let file = handle.open_with(
        name,
        OpenOptions::new().read(true).follow(FollowSymlinks::No),
    )?;
    let ceiling = limit.saturating_add(1);
    let mut bytes = Vec::new();
    file.take(ceiling).read_to_end(&mut bytes)?;
    if u64::try_from(bytes.len()).unwrap_or(u64::MAX) > limit {
        return Ok(None);
    }
    Ok(Some(bytes))
}
