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
//! # Why there are two gates
//!
//! The **write gate** serialises mutations against each other. The **scan
//! gate** is held across each scan *and* the publish that follows it, by every
//! caller — mutations, the watcher, the periodic reconcile and `POST /rescan`.
//!
//! The second gate exists because a scan and a publish that are not atomic
//! together can be interleaved: a slow watcher scan that began before a
//! mutation can finish after it and publish a tree that predates the write,
//! silently reverting the daemon's own view of the vault until something else
//! happens to rescan. Holding one gate across both makes publishes totally
//! ordered by the moment their scan ran, so the newest scan always wins. Lock
//! order is always write gate then scan gate; nothing takes them the other way.
//!
//! # Why the generation is content-derived
//!
//! Every published scan is fingerprinted over exactly what the API exposes. The
//! generation advances only when that fingerprint changes. This gives three
//! things at once: the daemon's own writes never produce a phantom change
//! event, because the watcher's rescan finds the fingerprint it just published;
//! a watcher event that turns out to be noise costs a scan and nothing more;
//! and a change that arrives with no event at all is still caught by the next
//! periodic reconcile.
//!
//! # Why filesystem work goes through `fsx`
//!
//! Nothing here names a path twice. Directories are opened once as no-follow
//! handles and every child is resolved against them, so a symbolic link
//! substituted underneath a running mutation fails the operation instead of
//! redirecting it. See the `fsx` module.
//!
//! # Errors
//!
//! Methods return [`Problem`] rather than a private error type. This module is
//! the only place that knows *why* something was refused, and translating that
//! knowledge into a code twice — once here, once in the handlers — is how the
//! two drift apart.

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash as _, Hasher as _};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard};

use bbb_vault_core::{
    Access, BookmarkFile, BookmarkNode, BookmarkUpdate, FOLDER_FILE_NAME, FolderFile, FolderNode,
    FolderUpdate, Id, NameAllocator, Revision, UpdateError, VaultScan, assets_directory_name,
    render_bookmark, render_folder, scan,
};
use cap_fs_ext::DirExt as _;
use cap_std::fs::Dir;
use tokio::sync::broadcast;

use crate::clock;
use crate::dto::{self, BookmarkDto};
use crate::entry::EntryRef;
use crate::fsx;
use crate::problem::{Problem, ProblemCode};
use crate::staging::Staged;
use crate::subtree;

/// How many change notifications a slow SSE client may fall behind before it is
/// told to resynchronise.
const CHANGE_CHANNEL_CAPACITY: usize = 64;

/// How many names are tried before a create or a move gives up.
///
/// Each attempt is a claim that lost to a concurrent writer. Sixty-four
/// consecutive losses is not contention; it is a directory something else is
/// fighting over.
const NAME_ATTEMPTS: usize = 64;

/// A vault the daemon has open.
#[derive(Debug)]
pub struct Vault {
    /// The path, kept for logging and for rescanning by name.
    root_path: PathBuf,
    /// The vault root, opened once, no-follow.
    root: Dir,
    /// `<vault>/.bbb`, where staging lives. Absent when the vault was opened
    /// read-only, which is the offline `bbb rescan` path and never mutates.
    state: Option<Dir>,
    published: RwLock<VaultState>,
    /// Serialises mutations inside this process. The on-disk lock keeps other
    /// processes out; this keeps our own request handlers from interleaving.
    write_gate: Mutex<()>,
    /// Held across scan *and* publish, so publishes are ordered by their scan.
    scan_gate: Mutex<()>,
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
    /// Opens `root` for reading only.
    ///
    /// Mutations through a vault opened this way are refused, because staging a
    /// reversible delete needs the `.bbb` directory this deliberately does not
    /// create. It is the offline `bbb rescan` path, which only reads.
    ///
    /// # Errors
    ///
    /// Returns any I/O error from opening or scanning the root, including the
    /// refusal to treat a symbolic link as a vault root.
    pub fn open(root: &Path) -> io::Result<Self> {
        Self::build(root, None)
    }

    /// Opens `root` for reading and writing, with `state` as `<vault>/.bbb`.
    ///
    /// # Errors
    ///
    /// As [`Vault::open`].
    pub(crate) fn open_with_state(root: &Path, state: Dir) -> io::Result<Self> {
        Self::build(root, Some(state))
    }

    fn build(root_path: &Path, state: Option<Dir>) -> io::Result<Self> {
        let root_path = std::path::absolute(root_path)?;
        let root = fsx::open_root(&root_path)?;
        let scan = scan(&root_path)?;
        let fingerprint = fingerprint(&scan);
        let (changes, _) = broadcast::channel(CHANGE_CHANNEL_CAPACITY);
        Ok(Self {
            root_path,
            root,
            state,
            published: RwLock::new(VaultState {
                scan: Arc::new(scan),
                generation: 1,
                fingerprint,
            }),
            write_gate: Mutex::new(()),
            scan_gate: Mutex::new(()),
            changes,
        })
    }

    /// The absolute vault root.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root_path
    }

    /// The current published view.
    #[must_use]
    pub fn snapshot(&self) -> Snapshot {
        let state = self.read_published();
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
    /// The scan and the publish happen under one gate, so a scan that started
    /// earlier can never be published after one that started later.
    ///
    /// # Errors
    ///
    /// Returns [`ProblemCode::VaultUnavailable`] when the vault cannot be read.
    pub fn reconcile(&self) -> Result<(Snapshot, bool), Problem> {
        let _gate = self.scan_gate();
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
        let _write = self.write_gate();
        let scan = self.plan_scan()?;
        let parent_node = writable_folder(&scan, parent)?;
        let title = validated_title(title)?;
        let parent_dir = self.dir_of(parent_node.relative_path())?;

        let id = fresh_id(&scan)?;
        let mut names = allocator_for(&parent_dir)?;

        if let Some(url) = url {
            let url = validated_url(url)?;
            let now = clock::now_rfc3339();
            let document =
                render_bookmark(id, url, title, &now, &now).map_err(|e| update_problem(&e))?;
            create_bookmark_file(&parent_dir, &mut names, title, id, document.as_bytes())?;
        } else {
            let document = render_folder(id, Some(title)).map_err(|e| update_problem(&e))?;
            create_folder_directory(&parent_dir, &mut names, title, document.as_bytes())?;
        }

        self.settle(&EntryRef::Identity(id))
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
        let _write = self.write_gate();
        let expected = parse_revision(revision)?;
        let scan = self.plan_scan()?;

        match locate(&scan, reference)? {
            Located::Bookmark(node) => {
                let title = title.map(validated_title).transpose()?;
                let url = url.map(validated_url).transpose()?;
                require_writable(node.access(), "the bookmark")?;
                let dir = self.parent_dir_of(node.relative_path())?;
                update_bookmark(&dir, node.file_name(), expected, title, url)?;
            }
            Located::Folder(node) => {
                if url.is_some() {
                    return Err(Problem::new(
                        ProblemCode::InvalidValue,
                        "a folder has no url",
                    ));
                }
                let title = title.map(validated_title).transpose()?;
                require_writable(node.access(), "the folder")?;
                let dir = self.dir_of(node.relative_path())?;
                update_folder(&dir, expected, title)?;
            }
        }

        self.settle(reference)
    }

    /// Deletes a bookmark, together with its colocated assets directory.
    ///
    /// Nothing is removed in place. Both entries are renamed into
    /// `<vault>/.bbb/staging` first, and only destroyed once both have moved,
    /// so a failure part-way puts them back rather than leaving a bookmark
    /// whose assets are gone or the reverse.
    ///
    /// # Errors
    ///
    /// [`ProblemCode::NotFound`], [`ProblemCode::StaleRevision`],
    /// [`ProblemCode::ReadOnly`], [`ProblemCode::PartialFailure`] when a
    /// rollback itself failed, or [`ProblemCode::VaultUnavailable`].
    pub fn delete_bookmark(&self, reference: &EntryRef, revision: &str) -> Result<(), Problem> {
        let _write = self.write_gate();
        let expected = parse_revision(revision)?;
        let scan = self.plan_scan()?;

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
        let dir = self.parent_dir_of(node.relative_path())?;
        check_revision(expected, revision_of(&dir, node.file_name())?)?;

        let assets = assets_directory_name(node.file_name());
        let has_assets = is_directory(&dir, &assets);

        let mut staged = self.staging(node.id().as_str())?;
        if let Err(error) = staged.take(&dir, node.file_name(), false) {
            return Err(rollback(
                staged,
                "the bookmark could not be removed",
                &error,
            ));
        }
        if has_assets && let Err(error) = staged.take(&dir, &assets, true) {
            return Err(rollback(
                staged,
                "the bookmark's assets could not be removed",
                &error,
            ));
        }

        staged
            .commit()
            .map_err(|error| io_problem("the staged entries could not be destroyed", &error))?;
        self.reconcile()?;
        Ok(())
    }

    /// Deletes a folder, and with `recursive` everything inside it.
    ///
    /// Emptiness is judged by the real directory listing rather than by the
    /// managed tree, so a directory holding the user's own notes still demands
    /// the explicit recursive request. A recursive delete additionally proves
    /// the whole subtree is managed and unchanged before anything moves — see
    /// the `subtree` module.
    ///
    /// # Errors
    ///
    /// [`ProblemCode::FolderNotEmpty`] when the folder has contents and
    /// `recursive` is false, [`ProblemCode::SubtreeHasUnknownFiles`] and
    /// [`ProblemCode::SubtreeChanged`] from the subtree proof, plus the errors
    /// of [`Vault::delete_bookmark`].
    pub fn delete_folder(
        &self,
        reference: &EntryRef,
        revision: &str,
        recursive: bool,
    ) -> Result<(), Problem> {
        let _write = self.write_gate();
        let expected = parse_revision(revision)?;
        let scan = self.plan_scan()?;

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

        let handle = self.dir_of(node.relative_path())?;
        check_revision(expected, revision_of(&handle, FOLDER_FILE_NAME)?)?;

        let occupants = occupant_count(&handle)?;
        if occupants > 0 && !recursive {
            return Err(Problem::new(
                ProblemCode::FolderNotEmpty,
                format!("the folder contains {occupants} entries; retry with recursive=true"),
            ));
        }
        if recursive {
            // The single revision the client sent covers this folder's metadata
            // and nothing below it, so permission to erase the subtree has to be
            // established here rather than assumed.
            subtree::verify_deletable(&handle, node).map_err(|r| subtree_problem(&r))?;
        }
        drop(handle);

        let parent = self.parent_dir_of(node.relative_path())?;
        let staging_id = node
            .id()
            .map_or_else(|| "folder".to_owned(), |id| id.as_str().to_owned());
        let mut staged = self.staging(&staging_id)?;
        if let Err(error) = staged.take(&parent, node.directory_name(), true) {
            return Err(rollback(staged, "the folder could not be removed", &error));
        }

        staged
            .commit()
            .map_err(|error| io_problem("the staged folder could not be destroyed", &error))?;
        self.reconcile()?;
        Ok(())
    }

    /// Moves an entry into another folder, keeping its identity.
    ///
    /// The move is a rename inside the vault, so the front matter — and with it
    /// the identity, the revision and every unknown byte — is untouched. A
    /// bookmark's assets move with it, and if they cannot, the bookmark is
    /// moved back so the pair never separates.
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
        let _write = self.write_gate();
        let expected = parse_revision(revision)?;
        let scan = self.plan_scan()?;
        let destination_node = writable_folder(&scan, parent)?;
        let destination = self.dir_of(destination_node.relative_path())?;

        match locate(&scan, reference)? {
            Located::Bookmark(node) => {
                require_writable(node.access(), "the bookmark")?;
                let source = self.parent_dir_of(node.relative_path())?;
                check_revision(expected, revision_of(&source, node.file_name())?)?;
                if parent_path(node.relative_path()) != destination_node.relative_path() {
                    move_bookmark(&source, node, &destination)?;
                }
            }
            Located::Folder(node) => {
                if node.relative_path().is_empty() {
                    return Err(Problem::new(
                        ProblemCode::InvalidValue,
                        "the vault root cannot be moved",
                    ));
                }
                require_writable(node.access(), "the folder")?;
                let handle = self.dir_of(node.relative_path())?;
                check_revision(expected, revision_of(&handle, FOLDER_FILE_NAME)?)?;
                drop(handle);
                guard_move_into_self(node, destination_node)?;
                if parent_path(node.relative_path()) != destination_node.relative_path() {
                    let source = self.parent_dir_of(node.relative_path())?;
                    move_folder(&source, node, &destination)?;
                }
            }
        }

        self.settle(reference)
    }

    // -- internals --------------------------------------------------------

    /// Opens a staging area for one operation.
    fn staging(&self, id: &str) -> Result<Staged, Problem> {
        let state = self.state.as_ref().ok_or_else(|| {
            Problem::new(
                ProblemCode::VaultUnavailable,
                "this vault was opened for reading only",
            )
        })?;
        Staged::open(state, id)
            .map_err(|error| io_problem("the staging area could not be opened", &error))
    }

    /// A handle to the vault-relative directory `relative`.
    fn dir_of(&self, relative: &str) -> Result<Dir, Problem> {
        fsx::open_relative_dir(&self.root, relative)
            .map_err(|error| io_problem("a vault directory could not be opened", &error))
    }

    /// A handle to the directory containing the entry at `relative`.
    fn parent_dir_of(&self, relative: &str) -> Result<Dir, Problem> {
        self.dir_of(parent_path(relative))
    }

    fn write_gate(&self) -> MutexGuard<'_, ()> {
        self.write_gate
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn scan_gate(&self) -> MutexGuard<'_, ()> {
        self.scan_gate
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn read_published(&self) -> RwLockReadGuard<'_, VaultState> {
        self.published
            .read()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// The authoritative scan a mutation plans against.
    ///
    /// Taken under the scan gate so it cannot observe the vault mid-publish.
    fn plan_scan(&self) -> Result<VaultScan, Problem> {
        let _gate = self.scan_gate();
        self.scan_now()
    }

    fn scan_now(&self) -> Result<VaultScan, Problem> {
        scan(&self.root_path).map_err(|error| io_problem("the vault could not be scanned", &error))
    }

    fn publish(&self, scan: VaultScan) -> (Snapshot, bool) {
        let fingerprint = fingerprint(&scan);
        let mut state = self
            .published
            .write()
            .unwrap_or_else(PoisonError::into_inner);
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
    fn settle(&self, reference: &EntryRef) -> Result<BookmarkDto, Problem> {
        let (snapshot, _) = self.reconcile()?;
        let located = locate(&snapshot.scan, reference)?;
        Ok(located.to_dto(&snapshot.scan))
    }
}

/// Creates a bookmark file, retrying if a name is claimed underneath us.
fn create_bookmark_file(
    parent: &Dir,
    names: &mut NameAllocator,
    title: &str,
    id: Id,
    document: &[u8],
) -> Result<(), Problem> {
    for _ in 0..NAME_ATTEMPTS {
        let name = names.allocate_bookmark(title, id);
        match fsx::create_new(parent, &name, document) {
            Ok(()) => return Ok(()),
            // Something claimed the name between listing the directory and
            // creating the file. `create_new` caught it, so take the next name
            // the allocator offers rather than overwriting anything.
            // Something claimed the name; the next allocator name is a
            // different one, so fall through to it.
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(io_problem("the bookmark could not be written", &error)),
        }
    }
    Err(name_exhausted())
}

/// Creates a folder directory and its metadata, undoing the first on failure.
fn create_folder_directory(
    parent: &Dir,
    names: &mut NameAllocator,
    title: &str,
    document: &[u8],
) -> Result<(), Problem> {
    for _ in 0..NAME_ATTEMPTS {
        let name = names.allocate_folder(title);
        match parent.create_dir(&name) {
            Ok(()) => {
                let child = parent
                    .open_dir_nofollow(&name)
                    .map_err(|error| io_problem("the new folder could not be opened", &error))?;
                return match fsx::create_new(&child, FOLDER_FILE_NAME, document) {
                    Ok(()) => Ok(()),
                    Err(error) => {
                        // A directory with no identity is worse than no
                        // directory, so undo it and leave the vault as it was.
                        drop(child);
                        let undone = parent.remove_dir(&name).is_ok();
                        Err(partial_or_io(
                            "the folder metadata could not be written",
                            &error,
                            undone,
                        ))
                    }
                };
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(io_problem("the folder could not be created", &error)),
        }
    }
    Err(name_exhausted())
}

/// Applies a title and URL change to one bookmark file.
fn update_bookmark(
    dir: &Dir,
    name: &str,
    expected: Revision,
    title: Option<&str>,
    url: Option<&str>,
) -> Result<(), Problem> {
    let source = read_entry(dir, name)?;
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

    // Ask what the change alone would produce. If that is the file we already
    // have, the request was a no-op and must not touch the disk — stamping
    // `bbb_updated` first would have made it one.
    let probe = file
        .apply(&source, &requested(None))
        .map_err(|e| update_problem(&e))?;
    if probe == source {
        return Ok(());
    }

    let now = clock::now_rfc3339();
    let bytes = file
        .apply(&source, &requested(Some(&now)))
        .map_err(|e| update_problem(&e))?;
    fsx::replace(dir, name, &bytes)
        .map_err(|error| io_problem("the bookmark could not be written", &error))
}

/// Applies a title change to one `.bbb-folder.md`.
fn update_folder(dir: &Dir, expected: Revision, title: Option<&str>) -> Result<(), Problem> {
    let source = read_entry(dir, FOLDER_FILE_NAME)?;
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
        .map_err(|e| update_problem(&e))?;
    if bytes == source {
        return Ok(());
    }
    fsx::replace(dir, FOLDER_FILE_NAME, &bytes)
        .map_err(|error| io_problem("the folder metadata could not be written", &error))
}

/// Renames a bookmark into `destination`, taking its assets with it.
fn move_bookmark(source: &Dir, node: &BookmarkNode, destination: &Dir) -> Result<(), Problem> {
    let mut names = allocator_for(destination)?;
    let assets = assets_directory_name(node.file_name());
    let has_assets = is_directory(source, &assets);

    // Keep the existing filename when the destination has room for it, so a
    // move is invisible in Git beyond the rename itself.
    let mut candidate = if names.reserve(node.file_name()) {
        node.file_name().to_owned()
    } else {
        names.allocate_bookmark(node.title(), node.id())
    };

    for attempt in 0..NAME_ATTEMPTS {
        match fsx::move_file(source, node.file_name(), destination, &candidate) {
            Ok(()) => {
                if !has_assets {
                    return Ok(());
                }
                let target = assets_directory_name(&candidate);
                return match fsx::move_dir(source, &assets, destination, &target) {
                    Ok(()) => Ok(()),
                    Err(error) => {
                        // The bookmark has already moved. Put it back, so the
                        // pair is never split across two folders.
                        let undone =
                            fsx::move_file(destination, &candidate, source, node.file_name())
                                .is_ok();
                        Err(partial_or_io(
                            "the bookmark's assets could not be moved",
                            &error,
                            undone,
                        ))
                    }
                };
            }
            // The name was taken between listing the destination and the
            // rename. Nothing was overwritten; take the next name.
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                if attempt + 1 == NAME_ATTEMPTS {
                    break;
                }
                candidate = names.allocate_bookmark(node.title(), node.id());
            }
            Err(error) => return Err(io_problem("the bookmark could not be moved", &error)),
        }
    }
    Err(name_exhausted())
}

/// Renames a directory into `destination`.
fn move_folder(source: &Dir, node: &FolderNode, destination: &Dir) -> Result<(), Problem> {
    let mut names = allocator_for(destination)?;
    let mut candidate = if names.reserve(node.directory_name()) {
        node.directory_name().to_owned()
    } else {
        names.allocate_folder(node.title())
    };

    for attempt in 0..NAME_ATTEMPTS {
        match fsx::move_dir(source, node.directory_name(), destination, &candidate) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                if attempt + 1 == NAME_ATTEMPTS {
                    break;
                }
                candidate = names.allocate_folder(node.title());
            }
            Err(error) => return Err(io_problem("the folder could not be moved", &error)),
        }
    }
    Err(name_exhausted())
}

fn guard_move_into_self(node: &FolderNode, destination: &FolderNode) -> Result<(), Problem> {
    let own = node.relative_path();
    let target = destination.relative_path();
    if target == own || target.starts_with(&format!("{own}/")) {
        return Err(Problem::new(
            ProblemCode::MoveIntoSelf,
            "a folder cannot be moved into itself or into one of its own descendants",
        ));
    }
    Ok(())
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
    if relative_path.is_empty() {
        return None;
    }
    folder_at(scan.folder(), parent_path(relative_path)).map(dto::folder_ref)
}

/// The vault-relative directory holding `relative_path`.
fn parent_path(relative_path: &str) -> &str {
    relative_path
        .rsplit_once('/')
        .map_or("", |(parent, _)| parent)
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

/// Seeds a name allocator with every name already present in `dir`.
///
/// The listing is used rather than the scanned tree because a vault holds the
/// user's own files too, and a new bookmark must not collide with one of them.
/// It is only a starting point: every create still goes through `create_new`,
/// which is what actually makes the claim safe against a concurrent writer.
fn allocator_for(dir: &Dir) -> Result<NameAllocator, Problem> {
    let entries = dir
        .entries()
        .map_err(|error| io_problem("the folder could not be listed", &error))?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| io_problem("the folder could not be listed", &error))?;
        names.push(entry.file_name().to_string_lossy().into_owned());
    }
    Ok(NameAllocator::from_existing(names))
}

/// Counts everything in `dir` except the folder's own metadata file.
fn occupant_count(dir: &Dir) -> Result<usize, Problem> {
    let entries = dir
        .entries()
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

/// Whether `name` in `dir` is a real directory, judged without following links.
fn is_directory(dir: &Dir, name: &str) -> bool {
    dir.symlink_metadata(name)
        .is_ok_and(|metadata| metadata.is_dir())
}

fn read_entry(dir: &Dir, name: &str) -> Result<Vec<u8>, Problem> {
    fsx::read(dir, name).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => Problem::new(
            ProblemCode::NotFound,
            "the entry is no longer on disk; rescan and retry",
        ),
        _ => io_problem("the entry could not be read", &error),
    })
}

fn revision_of(dir: &Dir, name: &str) -> Result<Revision, Problem> {
    read_entry(dir, name).map(|bytes| Revision::of(&bytes))
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

fn subtree_problem(refusal: &subtree::SubtreeRefusal) -> Problem {
    let code = match refusal {
        subtree::SubtreeRefusal::Unknown { .. } => ProblemCode::SubtreeHasUnknownFiles,
        subtree::SubtreeRefusal::Changed { .. } => ProblemCode::SubtreeChanged,
        subtree::SubtreeRefusal::Unreadable { .. } => ProblemCode::VaultUnavailable,
    };
    Problem::new(code, refusal.detail())
}

/// Rolls a staged operation back and reports the original failure.
fn rollback(staged: Staged, context: &str, cause: &io::Error) -> Problem {
    match staged.rollback() {
        Ok(()) => io_problem(context, cause),
        Err(restore) => Problem::new(
            ProblemCode::PartialFailure,
            format!(
                "{context} ({}), and undoing the change failed as well ({}); the entries are held \
                 in the vault's `.bbb/staging` directory and are cleared on the next start",
                cause.kind(),
                restore.kind()
            ),
        ),
    }
}

/// A failure whose severity depends on whether the undo worked.
fn partial_or_io(context: &str, cause: &io::Error, undone: bool) -> Problem {
    if undone {
        io_problem(context, cause)
    } else {
        Problem::new(
            ProblemCode::PartialFailure,
            format!(
                "{context} ({}), and the change could not be undone; run `bbb doctor` to see the \
                 current state of the vault",
                cause.kind()
            ),
        )
    }
}

fn name_exhausted() -> Problem {
    Problem::new(
        ProblemCode::VaultUnavailable,
        "no free name was found in the destination folder after many attempts",
    )
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
