//! Deterministic, symlink-free traversal of a vault directory tree.
//!
//! The scan is the authoritative view of a vault: watchers and caches are only
//! ever hints, and a rescan must always be able to rebuild the same tree from
//! the same bytes. Two runs over identical content therefore produce identical
//! output, including the order of siblings and of diagnostics.
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
    folders: Vec<FolderNode>,
    bookmarks: Vec<BookmarkNode>,
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

    /// Child directories, in display order.
    #[must_use]
    pub fn folders(&self) -> &[FolderNode] {
        &self.folders
    }

    /// Child bookmarks, in display order.
    #[must_use]
    pub fn bookmarks(&self) -> &[BookmarkNode] {
        &self.bookmarks
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
    for child in &folder.folders {
        collect_folders(child, out);
    }
}

fn collect_bookmarks<'a>(folder: &'a FolderNode, out: &mut Vec<&'a BookmarkNode>) {
    for child in &folder.folders {
        collect_bookmarks(child, out);
    }
    out.extend(folder.bookmarks.iter());
}

fn collect_diagnostics<'a>(folder: &'a FolderNode, out: &mut Vec<&'a Diagnostic>) {
    out.extend(folder.diagnostics.iter());
    for child in &folder.folders {
        collect_diagnostics(child, out);
    }
    for bookmark in &folder.bookmarks {
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
/// Where the root has a parent, the directory is opened *through a handle on
/// that parent* with the no-follow flag, so the rejection is race-free: there is
/// no window in which the name could be swapped. A root with no parent (a
/// filesystem root, or a bare relative name with no parent component) is opened
/// directly and checked with `symlink_metadata`; that check is not race-free,
/// but such a root is a deliberately configured, trusted path.
fn open_vault_root(root: &Path) -> io::Result<Dir> {
    let has_usable_parent = root
        .parent()
        .is_some_and(|parent| !parent.as_os_str().is_empty());
    let file_name = root.file_name().filter(|_| has_usable_parent);
    let is_normal_component = root
        .components()
        .next_back()
        .is_some_and(|component| matches!(component, Component::Normal(_)));

    if let (Some(name), true) = (file_name, is_normal_component) {
        let parent = root.parent().unwrap_or_else(|| Path::new("."));
        let parent = Dir::open_ambient_dir(parent, ambient_authority())?;
        return parent.open_dir_nofollow(name).map_err(|error| {
            io::Error::new(
                error.kind(),
                format!(
                    "the vault root {} could not be opened as a real directory \
                     (symbolic links and reparse points are refused): {error}",
                    root.display()
                ),
            )
        });
    }

    if std::fs::symlink_metadata(root)?.file_type().is_symlink() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "the vault root {} is a symbolic link; point the vault at the real directory",
                root.display()
            ),
        ));
    }
    Dir::open_ambient_dir(root, ambient_authority())
}

/// What a single directory contributes to the tree while it is being built.
#[derive(Debug, Default)]
struct Contents {
    diagnostics: Vec<Diagnostic>,
    folders: Vec<FolderNode>,
    bookmarks: Vec<BookmarkNode>,
    metadata: Option<FolderMetadata>,
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
    for (name, file_type) in read_children(handle, &relative_path, &mut contents)? {
        let child_relative = join_relative(&relative_path, &name);
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

    let mut folders = contents.folders;
    let mut bookmarks = contents.bookmarks;
    folders.sort_by(|left, right| {
        order_key(&left.title, &left.relative_path)
            .cmp(&order_key(&right.title, &right.relative_path))
    });
    bookmarks.sort_by(|left, right| {
        order_key(&left.title, &left.relative_path)
            .cmp(&order_key(&right.title, &right.relative_path))
    });

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
        folders,
        bookmarks,
    })
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
    if !is_folder_file && (name.starts_with('.') || !has_markdown_extension(&name)) {
        return;
    }

    let bytes = match read_limited(handle, &name, options.max_file_bytes) {
        Ok(Some(bytes)) => bytes,
        Ok(None) => {
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
    for bookmark in &folder.bookmarks {
        claimants
            .entry(bookmark.id)
            .or_default()
            .push(bookmark.relative_path.clone());
    }
    for child in &folder.folders {
        collect_claims(child, claimants);
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
    for bookmark in &mut folder.bookmarks {
        if let Some(paths) = claimants.get(&bookmark.id) {
            let own = bookmark.relative_path.clone();
            let diagnostic = duplicate_id(bookmark.id, paths, &own);
            bookmark.diagnostics.push(diagnostic);
            bookmark.access = Access::ReadOnly;
        }
    }
    for child in &mut folder.folders {
        mark_claims(child, claimants);
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

/// The deterministic sibling order from the vault specification: folders first
/// (enforced by keeping the two lists apart), then case-folded title, then the
/// vault-relative path as a tiebreaker.
///
/// Titles are compared by their canonical caseless fold (see
/// [`crate::fold_key`]), which ignores case, folds `ß` to `ss`, and decomposes
/// accents — so `Éclair` sorts between `apple` and `Zebra` rather than after
/// every ASCII name, and two spellings of the same title always land in the same
/// place.
///
/// It is still not locale collation: the fold orders the decomposed code points,
/// so it will not match a Swedish speaker's expectation that `ö` sorts after
/// `z`, and it has no language-specific tailoring. Full collation needs a
/// Unicode collation table and a locale, neither of which a format core has.
/// What it does guarantee is that the order never changes between runs,
/// platforms or spellings.
fn order_key(title: &str, relative_path: &str) -> (String, String) {
    (fold_key(title), relative_path.to_owned())
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
