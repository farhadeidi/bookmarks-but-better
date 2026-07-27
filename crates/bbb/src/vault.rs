//! The daemon's view of one vault: a cached scan, a generation counter, and
//! the mutations that keep both honest.
//!
//! # Why every mutation rescans first
//!
//! The scan is the authority; the cache is a convenience for reads. A mutation
//! that trusted the cache could aim a write at a path that an external editor
//! moved a second ago. So each mutation takes the write gate, scans, resolves
//! its target against those fresh results, writes, and scans again to publish
//! the new tree. Two scans per mutation is the price of never guessing, and for
//! the vault sizes this milestone targets it is not a price worth optimising
//! away yet.
//!
//! # Why the generation is content-derived
//!
//! Every published scan is fingerprinted over exactly what the API exposes. The
//! generation advances only when that fingerprint changes. This single rule
//! gives three things at once: the daemon's own writes never produce a phantom
//! change event, because the watcher's rescan finds the fingerprint it just
//! published; a watcher event that turns out to be noise costs a scan and
//! nothing more; and a change that arrives with no event at all is still caught
//! by the next periodic reconcile.
//!
//! # Errors
//!
//! Methods return [`Problem`] rather than a private error type. This module is
//! the only place that knows *why* something was refused, and translating that
//! knowledge into a code twice — once here, once in the handlers — is how the
//! two drift apart.

use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash as _, Hasher as _};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};

use bbb_vault_core::{
    Access, BookmarkFile, BookmarkNode, BookmarkUpdate, FOLDER_FILE_NAME, FolderFile, FolderNode,
    FolderUpdate, Id, NameAllocator, Revision, UpdateError, VaultScan, assets_directory_name,
    render_bookmark, render_folder, scan,
};
use tokio::sync::broadcast;

use crate::atomic;
use crate::clock;
use crate::dto::{self, BookmarkDto};
use crate::entry::EntryRef;
use crate::problem::{Problem, ProblemCode};

/// How many change notifications a slow SSE client may fall behind before it is
/// told to resynchronise.
const CHANGE_CHANNEL_CAPACITY: usize = 64;

/// A vault the daemon has open.
#[derive(Debug)]
pub struct Vault {
    root: PathBuf,
    state: RwLock<VaultState>,
    /// Serialises mutations inside this process. The on-disk lock keeps other
    /// processes out; this keeps our own request handlers from interleaving.
    write_gate: Mutex<()>,
    changes: broadcast::Sender<u64>,
}

#[derive(Debug)]
struct VaultState {
    scan: Arc<VaultScan>,
    generation: u64,
    fingerprint: u64,
}

/// A published view of the vault.
#[derive(Debug, Clone)]
pub struct Snapshot {
    /// The tree as it was last scanned.
    pub scan: Arc<VaultScan>,
    /// The generation that tree belongs to.
    pub generation: u64,
}

impl Vault {
    /// Opens `root` and takes the first scan.
    ///
    /// # Errors
    ///
    /// Returns any I/O error from the initial scan, including the refusal to
    /// treat a symbolic link as a vault root.
    pub fn open(root: &Path) -> io::Result<Self> {
        let root = std::path::absolute(root)?;
        let scan = scan(&root)?;
        let fingerprint = fingerprint(&scan);
        let (changes, _) = broadcast::channel(CHANGE_CHANNEL_CAPACITY);
        Ok(Self {
            root,
            state: RwLock::new(VaultState {
                scan: Arc::new(scan),
                generation: 1,
                fingerprint,
            }),
            write_gate: Mutex::new(()),
            changes,
        })
    }

    /// The absolute vault root.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// The current published view.
    #[must_use]
    pub fn snapshot(&self) -> Snapshot {
        let state = self.read_state();
        Snapshot {
            scan: Arc::clone(&state.scan),
            generation: state.generation,
        }
    }

    /// Subscribes to generation changes.
    #[must_use]
    pub fn subscribe(&self) -> broadcast::Receiver<u64> {
        self.changes.subscribe()
    }

    /// Rescans and publishes, returning the new snapshot and whether anything
    /// actually changed.
    ///
    /// This is what the watcher, the periodic fallback and `POST /rescan` all
    /// call. It is safe to call as often as one likes; a scan that finds no
    /// difference publishes nothing and wakes no client.
    ///
    /// # Errors
    ///
    /// Returns [`ProblemCode::VaultUnavailable`] when the vault cannot be read.
    pub fn reconcile(&self) -> Result<(Snapshot, bool), Problem> {
        let scan = self.scan_now()?;
        Ok(self.publish(scan))
    }

    // -- reads ------------------------------------------------------------

    /// Renders one entry by address.
    ///
    /// # Errors
    ///
    /// [`ProblemCode::NotFound`] when nothing has the address, and
    /// [`ProblemCode::AmbiguousId`] when more than one entry claims it.
    pub fn get(&self, reference: &EntryRef) -> Result<BookmarkDto, Problem> {
        let snapshot = self.snapshot();
        let located = locate(&snapshot.scan, reference)?;
        Ok(located.to_dto(&snapshot.scan))
    }

    // -- mutations --------------------------------------------------------

    /// Creates a bookmark, or a folder when `url` is `None`.
    ///
    /// A create with no URL is a folder because that is what the browser
    /// bookmark APIs the web UI is written against do, and because the vault
    /// format has no representation for a bookmark without a target.
    ///
    /// # Errors
    ///
    /// [`ProblemCode::NotFound`] for an unknown parent, [`ProblemCode::ReadOnly`]
    /// when the parent must not be written, [`ProblemCode::InvalidValue`] for a
    /// title or URL the format cannot store, and
    /// [`ProblemCode::VaultUnavailable`] for I/O failures.
    pub fn create(
        &self,
        parent: &EntryRef,
        title: &str,
        url: Option<&str>,
    ) -> Result<BookmarkDto, Problem> {
        let _gate = self.gate();
        let scan = self.scan_now()?;
        let parent_node = writable_folder(&scan, parent)?;
        let title = validated_title(title)?;

        let id = fresh_id(&scan)?;
        let mut names = allocator_for(parent_node.path())?;

        if let Some(url) = url {
            let url = validated_url(url)?;
            let now = clock::now_rfc3339();
            let document = render_bookmark(id, url, title, &now, &now)
                .map_err(|error| update_problem(&error))?;
            let name = names.allocate_bookmark(title, id);
            atomic::create_new(&parent_node.path().join(&name), document.as_bytes())
                .map_err(|error| io_problem("the bookmark could not be written", &error))?;
        } else {
            let document =
                render_folder(id, Some(title)).map_err(|error| update_problem(&error))?;
            let name = names.allocate_folder(title);
            let directory = parent_node.path().join(&name);
            fs::create_dir(&directory)
                .map_err(|error| io_problem("the folder could not be created", &error))?;
            atomic::create_new(&directory.join(FOLDER_FILE_NAME), document.as_bytes())
                .map_err(|error| io_problem("the folder metadata could not be written", &error))?;
        }

        self.republish_and_render(&EntryRef::Identity(id))
    }

    /// Updates an entry's title, and a bookmark's URL.
    ///
    /// A request that would not change any byte writes nothing at all, which is
    /// what keeps a no-op mutation byte-identical. Only a request that does
    /// change something also refreshes `bbb_updated`.
    ///
    /// # Errors
    ///
    /// [`ProblemCode::StaleRevision`] when `revision` no longer matches disk,
    /// [`ProblemCode::ReadOnly`] for an entry with an error diagnostic, and
    /// [`ProblemCode::InvalidValue`] for a value the format cannot store.
    pub fn update(
        &self,
        reference: &EntryRef,
        revision: &str,
        title: Option<&str>,
        url: Option<&str>,
    ) -> Result<BookmarkDto, Problem> {
        let _gate = self.gate();
        let expected = parse_revision(revision)?;
        let scan = self.scan_now()?;

        match locate(&scan, reference)? {
            Located::Bookmark(node) => {
                let title = title.map(validated_title).transpose()?;
                let url = url.map(validated_url).transpose()?;
                update_bookmark(node, expected, title, url)?;
            }
            Located::Folder(node) => {
                if url.is_some() {
                    return Err(Problem::new(
                        ProblemCode::InvalidValue,
                        "a folder has no url",
                    ));
                }
                let title = title.map(validated_title).transpose()?;
                update_folder(node, expected, title)?;
            }
        }

        self.republish_and_render(reference)
    }

    /// Deletes a bookmark, together with its colocated assets directory.
    ///
    /// # Errors
    ///
    /// [`ProblemCode::NotFound`], [`ProblemCode::StaleRevision`],
    /// [`ProblemCode::ReadOnly`], or [`ProblemCode::VaultUnavailable`].
    pub fn delete_bookmark(&self, reference: &EntryRef, revision: &str) -> Result<(), Problem> {
        let _gate = self.gate();
        let expected = parse_revision(revision)?;
        let scan = self.scan_now()?;

        let node = match locate(&scan, reference)? {
            Located::Bookmark(node) => node,
            Located::Folder(_) => {
                return Err(Problem::new(
                    ProblemCode::InvalidValue,
                    "that id is a folder; use DELETE /api/v1/folders/{id}",
                ));
            }
        };
        require_writable(node.access(), "the bookmark")?;
        check_revision(expected, current_revision(node.path())?)?;

        fs::remove_file(node.path())
            .map_err(|error| io_problem("the bookmark could not be deleted", &error))?;
        // The assets directory belongs to the bookmark, so it goes with it. A
        // failure here is reported by the next scan rather than rolling back a
        // deletion that already succeeded.
        let assets = node
            .path()
            .with_file_name(assets_directory_name(node.file_name()));
        if assets.is_dir() {
            let _ = fs::remove_dir_all(&assets);
        }

        self.reconcile()?;
        Ok(())
    }

    /// Deletes a folder, and with `recursive` everything inside it.
    ///
    /// Emptiness is judged by the real directory listing rather than by the
    /// managed tree, so a directory holding the user's own notes still demands
    /// the explicit recursive request.
    ///
    /// # Errors
    ///
    /// [`ProblemCode::FolderNotEmpty`] when the folder has contents and
    /// `recursive` is false, plus the errors of [`Vault::delete_bookmark`].
    pub fn delete_folder(
        &self,
        reference: &EntryRef,
        revision: &str,
        recursive: bool,
    ) -> Result<(), Problem> {
        let _gate = self.gate();
        let expected = parse_revision(revision)?;
        let scan = self.scan_now()?;

        let node = match locate(&scan, reference)? {
            Located::Folder(node) => node,
            Located::Bookmark(_) => {
                return Err(Problem::new(
                    ProblemCode::InvalidValue,
                    "that id is a bookmark; use DELETE /api/v1/bookmarks/{id}",
                ));
            }
        };
        if node.relative_path().is_empty() {
            return Err(Problem::new(
                ProblemCode::InvalidValue,
                "the vault root cannot be deleted",
            ));
        }
        require_writable(node.access(), "the folder")?;
        check_revision(
            expected,
            current_revision(&node.path().join(FOLDER_FILE_NAME))?,
        )?;

        let occupants = occupant_count(node.path())?;
        if occupants > 0 && !recursive {
            return Err(Problem::new(
                ProblemCode::FolderNotEmpty,
                format!("the folder contains {occupants} entries; retry with recursive=true"),
            ));
        }

        fs::remove_dir_all(node.path())
            .map_err(|error| io_problem("the folder could not be deleted", &error))?;
        self.reconcile()?;
        Ok(())
    }

    /// Moves an entry into another folder, keeping its identity.
    ///
    /// The move is a rename inside the vault, so the front matter — and with it
    /// the identity, the revision and every unknown byte — is untouched.
    ///
    /// # Errors
    ///
    /// [`ProblemCode::MoveIntoSelf`] when the destination is the folder itself
    /// or one of its descendants, plus the errors of [`Vault::update`].
    pub fn move_entry(
        &self,
        reference: &EntryRef,
        revision: &str,
        parent: &EntryRef,
    ) -> Result<BookmarkDto, Problem> {
        let _gate = self.gate();
        let expected = parse_revision(revision)?;
        let scan = self.scan_now()?;
        let destination = writable_folder(&scan, parent)?;

        match locate(&scan, reference)? {
            Located::Bookmark(node) => {
                require_writable(node.access(), "the bookmark")?;
                check_revision(expected, current_revision(node.path())?)?;
                move_bookmark(node, destination)?;
            }
            Located::Folder(node) => {
                if node.relative_path().is_empty() {
                    return Err(Problem::new(
                        ProblemCode::InvalidValue,
                        "the vault root cannot be moved",
                    ));
                }
                require_writable(node.access(), "the folder")?;
                check_revision(
                    expected,
                    current_revision(&node.path().join(FOLDER_FILE_NAME))?,
                )?;
                move_folder(node, destination)?;
            }
        }

        self.republish_and_render(reference)
    }

    // -- internals --------------------------------------------------------

    fn gate(&self) -> std::sync::MutexGuard<'_, ()> {
        self.write_gate
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn read_state(&self) -> std::sync::RwLockReadGuard<'_, VaultState> {
        self.state
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn scan_now(&self) -> Result<VaultScan, Problem> {
        scan(&self.root).map_err(|error| io_problem("the vault could not be scanned", &error))
    }

    fn publish(&self, scan: VaultScan) -> (Snapshot, bool) {
        let fingerprint = fingerprint(&scan);
        let mut state = self
            .state
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let changed = state.fingerprint != fingerprint;
        if changed {
            state.generation += 1;
            state.fingerprint = fingerprint;
        }
        state.scan = Arc::new(scan);
        let snapshot = Snapshot {
            scan: Arc::clone(&state.scan),
            generation: state.generation,
        };
        drop(state);

        if changed {
            // The only receiver error is "nobody is listening", which is the
            // normal state of a daemon with no open UI.
            let _ = self.changes.send(snapshot.generation);
        }
        (snapshot, changed)
    }

    /// Publishes the post-mutation tree and renders the affected entry from it.
    fn republish_and_render(&self, reference: &EntryRef) -> Result<BookmarkDto, Problem> {
        let (snapshot, _) = self.reconcile()?;
        let located = locate(&snapshot.scan, reference)?;
        Ok(located.to_dto(&snapshot.scan))
    }
}

/// Applies a title and URL change to one bookmark file.
fn update_bookmark(
    node: &BookmarkNode,
    expected: Revision,
    title: Option<&str>,
    url: Option<&str>,
) -> Result<(), Problem> {
    require_writable(node.access(), "the bookmark")?;
    let source = read_file(node.path())?;
    check_revision(expected, Revision::of(&source))?;

    let file = BookmarkFile::parse(&source).map_err(|error| {
        Problem::new(
            ProblemCode::ReadOnly,
            format!("the bookmark cannot be updated: {error}"),
        )
    })?;

    let requested = |updated: Option<&str>| {
        let mut update = BookmarkUpdate::new();
        if let Some(title) = title {
            update = update.title(title);
        }
        if let Some(url) = url {
            update = update.url(url);
        }
        if let Some(updated) = updated {
            update = update.updated(updated);
        }
        update
    };

    // Ask what the change alone would produce. If that is the file we
    // already have, the request was a no-op and must not touch the disk —
    // stamping `bbb_updated` first would have made it one.
    let probe = file
        .apply(&source, &requested(None))
        .map_err(|error| update_problem(&error))?;
    if probe == source {
        return Ok(());
    }

    let now = clock::now_rfc3339();
    let bytes = file
        .apply(&source, &requested(Some(&now)))
        .map_err(|error| update_problem(&error))?;
    atomic::replace(node.path(), &bytes)
        .map_err(|error| io_problem("the bookmark could not be written", &error))
}

/// Applies a title change to one `.bbb-folder.md`.
fn update_folder(
    node: &FolderNode,
    expected: Revision,
    title: Option<&str>,
) -> Result<(), Problem> {
    require_writable(node.access(), "the folder")?;
    let path = node.path().join(FOLDER_FILE_NAME);
    let source = read_file(&path)?;
    check_revision(expected, Revision::of(&source))?;

    let file = FolderFile::parse(&source).map_err(|error| {
        Problem::new(
            ProblemCode::ReadOnly,
            format!("the folder metadata cannot be updated: {error}"),
        )
    })?;

    let mut update = FolderUpdate::new();
    if let Some(title) = title {
        update = update.title(title);
    }
    let bytes = file
        .apply(&source, &update)
        .map_err(|error| update_problem(&error))?;
    if bytes == source {
        return Ok(());
    }
    atomic::replace(&path, &bytes)
        .map_err(|error| io_problem("the folder metadata could not be written", &error))
}

/// Renames a bookmark file into `destination`, keeping its name when free.
fn move_bookmark(node: &BookmarkNode, destination: &FolderNode) -> Result<(), Problem> {
    if node.path().parent() == Some(destination.path()) {
        return Ok(());
    }
    let mut names = allocator_for(destination.path())?;
    // Keep the existing filename when the destination has room for it, so a
    // move is invisible in Git beyond the rename itself.
    let name = if names.reserve(node.file_name()) {
        node.file_name().to_owned()
    } else {
        names.allocate_bookmark(node.title(), node.id())
    };

    let target = destination.path().join(&name);
    fs::rename(node.path(), &target)
        .map_err(|error| io_problem("the bookmark could not be moved", &error))?;

    let assets = node
        .path()
        .with_file_name(assets_directory_name(node.file_name()));
    if assets.is_dir() {
        let _ = fs::rename(
            &assets,
            destination.path().join(assets_directory_name(&name)),
        );
    }
    Ok(())
}

/// Renames a directory into `destination`, refusing a move into itself.
fn move_folder(node: &FolderNode, destination: &FolderNode) -> Result<(), Problem> {
    if node.path() == destination.path() || destination.path().starts_with(node.path()) {
        return Err(Problem::new(
            ProblemCode::MoveIntoSelf,
            "a folder cannot be moved into itself or into one of its own descendants",
        ));
    }
    if node.path().parent() == Some(destination.path()) {
        return Ok(());
    }

    let mut names = allocator_for(destination.path())?;
    let name = if names.reserve(node.directory_name()) {
        node.directory_name().to_owned()
    } else {
        names.allocate_folder(node.title())
    };

    fs::rename(node.path(), destination.path().join(&name))
        .map_err(|error| io_problem("the folder could not be moved", &error))
}

/// Where an address resolved to.
enum Located<'a> {
    Bookmark(&'a BookmarkNode),
    Folder(&'a FolderNode),
}

impl Located<'_> {
    fn to_dto(&self, scan: &VaultScan) -> BookmarkDto {
        match self {
            Self::Bookmark(node) => {
                dto::bookmark_dto(node, parent_of_path(scan, node.relative_path()))
            }
            Self::Folder(node) => dto::folder_dto(node, parent_of_path(scan, node.relative_path())),
        }
    }
}

fn locate<'a>(scan: &'a VaultScan, reference: &EntryRef) -> Result<Located<'a>, Problem> {
    match reference {
        EntryRef::Identity(id) => {
            let bookmarks = scan.bookmarks_claiming(*id);
            let folders = scan.folders_claiming(*id);
            match (bookmarks.len(), folders.len()) {
                (0, 0) => Err(Problem::new(
                    ProblemCode::NotFound,
                    format!("no entry in this vault has the id `{id}`"),
                )),
                (1, 0) => Ok(Located::Bookmark(bookmarks[0])),
                (0, 1) => Ok(Located::Folder(folders[0])),
                (bookmarks, folders) => Err(Problem::new(
                    ProblemCode::AmbiguousId,
                    format!(
                        "{} entries claim the id `{id}`; every one of them is read-only until \
                         exactly one keeps it",
                        bookmarks + folders
                    ),
                )),
            }
        }
        EntryRef::Path(path) => folder_at(scan.folder(), path)
            .map(Located::Folder)
            .ok_or_else(|| {
                Problem::new(
                    ProblemCode::NotFound,
                    "no directory in this vault has that path",
                )
            }),
    }
}

fn folder_at<'a>(folder: &'a FolderNode, relative_path: &str) -> Option<&'a FolderNode> {
    if folder.relative_path() == relative_path {
        return Some(folder);
    }
    folder
        .folders()
        .iter()
        .find_map(|child| folder_at(child, relative_path))
}

/// The address of the folder containing `relative_path`, or `None` at the root.
fn parent_of_path(scan: &VaultScan, relative_path: &str) -> Option<EntryRef> {
    let parent_path = match relative_path.rsplit_once('/') {
        Some((parent, _)) => parent,
        None if relative_path.is_empty() => return None,
        None => "",
    };
    folder_at(scan.folder(), parent_path).map(dto::folder_ref)
}

/// Resolves an address that must be a folder the daemon may write into.
fn writable_folder<'a>(
    scan: &'a VaultScan,
    reference: &EntryRef,
) -> Result<&'a FolderNode, Problem> {
    match locate(scan, reference)? {
        Located::Folder(node) => {
            require_writable(node.access(), "the destination folder")?;
            if node.id().is_none() {
                return Err(Problem::new(
                    ProblemCode::ReadOnly,
                    format!(
                        "the directory has no `{FOLDER_FILE_NAME}`, so it has no stable identity \
                         and cannot hold managed entries"
                    ),
                ));
            }
            Ok(node)
        }
        Located::Bookmark(_) => Err(Problem::new(
            ProblemCode::InvalidValue,
            "the parent must be a folder",
        )),
    }
}

fn fresh_id(scan: &VaultScan) -> Result<Id, Problem> {
    Id::generate_unique(|candidate| {
        !scan.bookmarks_claiming(candidate).is_empty()
            || !scan.folders_claiming(candidate).is_empty()
    })
    .map_err(|error| {
        Problem::new(
            ProblemCode::VaultUnavailable,
            format!("a new identity could not be generated: {error}"),
        )
    })
}

/// Seeds a name allocator with every name already present in `directory`.
///
/// The listing is used rather than the scanned tree because a vault holds the
/// user's own files too, and a new bookmark must not collide with one of them.
fn allocator_for(directory: &Path) -> Result<NameAllocator, Problem> {
    let entries = fs::read_dir(directory)
        .map_err(|error| io_problem("the folder could not be listed", &error))?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| io_problem("the folder could not be listed", &error))?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    Ok(NameAllocator::from_existing(names))
}

/// Counts everything in `directory` except the folder's own metadata file.
fn occupant_count(directory: &Path) -> Result<usize, Problem> {
    let entries = fs::read_dir(directory)
        .map_err(|error| io_problem("the folder could not be listed", &error))?;
    let mut count = 0;
    for entry in entries {
        let entry = entry.map_err(|error| io_problem("the folder could not be listed", &error))?;
        if entry.file_name() != FOLDER_FILE_NAME {
            count += 1;
        }
    }
    Ok(count)
}

fn read_file(path: &Path) -> Result<Vec<u8>, Problem> {
    fs::read(path).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => Problem::new(
            ProblemCode::NotFound,
            "the entry is no longer on disk; rescan and retry",
        ),
        _ => io_problem("the entry could not be read", &error),
    })
}

fn current_revision(path: &Path) -> Result<Revision, Problem> {
    read_file(path).map(|bytes| Revision::of(&bytes))
}

fn parse_revision(text: &str) -> Result<Revision, Problem> {
    Revision::from_hex(text).ok_or_else(|| {
        Problem::new(
            ProblemCode::InvalidRequest,
            "a revision is 64 lowercase hexadecimal characters",
        )
    })
}

fn check_revision(expected: Revision, actual: Revision) -> Result<(), Problem> {
    if expected == actual {
        return Ok(());
    }
    Err(Problem::new(
        ProblemCode::StaleRevision,
        format!(
            "the entry changed on disk: expected revision {expected}, found {actual}. Reload it \
             and reapply the change"
        ),
    ))
}

fn require_writable(access: Access, subject: &str) -> Result<(), Problem> {
    match access {
        Access::ReadWrite => Ok(()),
        Access::ReadOnly => Err(Problem::new(
            ProblemCode::ReadOnly,
            format!("{subject} has an error-level diagnostic and must not be written"),
        )),
    }
}

fn validated_title(title: &str) -> Result<&str, Problem> {
    if title.trim().is_empty() {
        return Err(Problem::new(
            ProblemCode::InvalidValue,
            "a title cannot be empty",
        ));
    }
    Ok(title)
}

fn validated_url(url: &str) -> Result<&str, Problem> {
    if url.trim().is_empty() {
        return Err(Problem::new(
            ProblemCode::InvalidValue,
            "a url cannot be empty",
        ));
    }
    Ok(url)
}

fn update_problem(error: &UpdateError) -> Problem {
    match error {
        UpdateError::ReadOnly => Problem::new(
            ProblemCode::ReadOnly,
            "the entry has an error-level diagnostic and must not be written",
        ),
        UpdateError::StaleSource { expected, actual } => Problem::new(
            ProblemCode::StaleRevision,
            format!("the entry changed on disk: expected revision {expected}, found {actual}"),
        ),
        // `InvalidValue`, and anything a future core version adds: the value
        // could not be stored, which is the client's problem to fix.
        _ => Problem::new(ProblemCode::InvalidValue, error.to_string()),
    }
}

/// Builds a vault-unavailable problem without leaking a path into the message.
///
/// The `io::Error` display already names the operation; the path is deliberately
/// left out because these strings reach logs and a vault path can be personal.
fn io_problem(context: &str, error: &io::Error) -> Problem {
    Problem::new(
        ProblemCode::VaultUnavailable,
        format!("{context}: {}", error.kind()),
    )
}

/// Hashes exactly what the API exposes about a scan.
///
/// Anything a client can observe is in here, and nothing else is: two scans
/// with the same fingerprint are indistinguishable through the HTTP API, which
/// is what makes "the fingerprint changed" the right definition of "the vault
/// changed". The hash is only ever compared with another hash from the same
/// process, so a stable-across-releases algorithm is not required.
fn fingerprint(scan: &VaultScan) -> u64 {
    let mut hasher = DefaultHasher::new();
    hash_folder(scan.folder(), &mut hasher);
    hasher.finish()
}

fn hash_folder(folder: &FolderNode, hasher: &mut DefaultHasher) {
    folder.relative_path().hash(hasher);
    folder.id().map(|id| id.as_str().to_owned()).hash(hasher);
    folder.title().hash(hasher);
    folder
        .revision()
        .map(|revision| *revision.as_bytes())
        .hash(hasher);
    folder.access().as_str().hash(hasher);
    hash_diagnostics(folder.diagnostics(), hasher);

    for child in folder.folders() {
        hash_folder(child, hasher);
    }
    for bookmark in folder.bookmarks() {
        bookmark.relative_path().hash(hasher);
        bookmark.id().as_str().hash(hasher);
        bookmark.title().hash(hasher);
        bookmark.url().hash(hasher);
        bookmark.created().hash(hasher);
        bookmark.updated().hash(hasher);
        bookmark.logo().hash(hasher);
        bookmark.revision().as_bytes().hash(hasher);
        bookmark.access().as_str().hash(hasher);
        hash_diagnostics(bookmark.diagnostics(), hasher);
    }
}

fn hash_diagnostics(diagnostics: &[bbb_vault_core::Diagnostic], hasher: &mut DefaultHasher) {
    diagnostics.len().hash(hasher);
    for diagnostic in diagnostics {
        diagnostic.code().as_str().hash(hasher);
        diagnostic.path().hash(hasher);
        diagnostic.line().hash(hasher);
        diagnostic.detail().hash(hasher);
    }
}
