//! Deterministic, symlink-free traversal of a vault directory tree.
//!
//! The scan is the authoritative view of a vault: watchers and caches are only
//! ever hints, and a rescan must always be able to rebuild the same tree from
//! the same bytes. Two runs over identical content therefore produce identical
//! output, including the order of siblings and of diagnostics.

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

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

    /// Finds a bookmark by identity, wherever it currently lives.
    #[must_use]
    pub fn find_bookmark(&self, id: Id) -> Option<&BookmarkNode> {
        self.bookmarks().find(|bookmark| bookmark.id == id)
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
/// Returns an error only when the root itself cannot be read. Problems with
/// individual files become diagnostics so that one broken note never hides the
/// rest of the vault.
pub fn scan(root: &Path) -> io::Result<VaultScan> {
    scan_with(root, ScanOptions::default())
}

/// Walks `root` with explicit limits.
///
/// # Errors
///
/// As [`scan`].
pub fn scan_with(root: &Path, options: ScanOptions) -> io::Result<VaultScan> {
    let mut folder = walk(root, String::new(), 0, options)?;
    resolve_duplicate_ids(&mut folder);
    Ok(VaultScan {
        root: root.to_path_buf(),
        folder,
    })
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
    directory: &Path,
    relative_path: String,
    depth: usize,
    options: ScanOptions,
) -> io::Result<FolderNode> {
    let directory_name = directory.file_name().map_or_else(
        || directory.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    );

    let mut contents = Contents::default();
    for (name, path, file_type) in read_children(directory, &relative_path, &mut contents)? {
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
            visit_directory(&mut contents, &name, &path, &child_relative, depth, options);
        } else if file_type.is_file() {
            visit_file(&mut contents, name, path, child_relative, options);
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
        path: directory.to_path_buf(),
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
/// anything that can emit a diagnostic runs.
fn read_children(
    directory: &Path,
    relative_path: &str,
    contents: &mut Contents,
) -> io::Result<Vec<(String, PathBuf, fs::FileType)>> {
    let mut children = Vec::new();
    for entry in fs::read_dir(directory)? {
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
        // `DirEntry::file_type` reports the link itself, never its target.
        children.push((name.to_owned(), entry.path(), entry.file_type()?));
    }
    children.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(children)
}

fn visit_directory(
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

    match walk(path, child_relative.to_owned(), depth + 1, options) {
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
    contents: &mut Contents,
    name: String,
    path: PathBuf,
    child_relative: String,
    options: ScanOptions,
) {
    let is_folder_file = name == FOLDER_FILE_NAME;
    if !is_folder_file && (name.starts_with('.') || !has_markdown_extension(&name)) {
        return;
    }

    let bytes = match read_limited(&path, options.max_file_bytes) {
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
                    format!("the file could not be read: {error}"),
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
            path,
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

/// Marks every entry after the first that claims an already-used identity.
///
/// The first entry in traversal order keeps the identity so that repeated scans
/// of an unchanged vault always pick the same winner.
fn resolve_duplicate_ids(root: &mut FolderNode) {
    let mut owners: HashMap<Id, String> = HashMap::new();
    claim_ids(root, &mut owners);
}

fn claim_ids(folder: &mut FolderNode, owners: &mut HashMap<Id, String>) {
    if let Some(id) = folder.id {
        let relative_path = folder.relative_path.clone();
        match owners.get(&id) {
            Some(owner) if *owner != relative_path => {
                folder
                    .diagnostics
                    .push(duplicate_id(id, owner, &relative_path));
                folder.access = Access::ReadOnly;
            }
            Some(_) => {}
            None => {
                owners.insert(id, relative_path);
            }
        }
    }
    for bookmark in &mut folder.bookmarks {
        let id = bookmark.id;
        match owners.get(&id) {
            Some(owner) if *owner != bookmark.relative_path => {
                let diagnostic = duplicate_id(id, owner, &bookmark.relative_path);
                bookmark.diagnostics.push(diagnostic);
                bookmark.access = Access::ReadOnly;
            }
            Some(_) => {}
            None => {
                owners.insert(id, bookmark.relative_path.clone());
            }
        }
    }
    for child in &mut folder.folders {
        claim_ids(child, owners);
    }
}

fn duplicate_id(id: Id, owner: &str, relative_path: &str) -> Diagnostic {
    Diagnostic::new(
        DiagnosticCode::DuplicateId,
        format!(
            "the identity `{id}` is already used by `{}`",
            display_path(owner)
        ),
    )
    .at_path(relative_path)
}

/// The deterministic sibling order from the vault specification: folders first
/// (enforced by keeping the two lists apart), then case-folded title, then the
/// vault-relative path as a tiebreaker.
///
/// The title comparison is Unicode-aware simple lowercasing followed by code
/// point order. It is not locale collation, so `Éclair` sorts after `Zebra`
/// rather than next to `Eclair`; real collation needs a Unicode collation table
/// and is not worth a dependency for a rule whose only hard requirement is that
/// it never changes between runs.
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

/// Reads a file, returning `None` when it exceeds `limit`.
fn read_limited(path: &Path, limit: u64) -> io::Result<Option<Vec<u8>>> {
    // `symlink_metadata` rather than `metadata`: the entry has already been
    // checked, but a race must not turn into a followed link.
    if fs::symlink_metadata(path)?.len() > limit {
        return Ok(None);
    }
    fs::read(path).map(Some)
}
