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
//! # The operation gate
//!
//! There is exactly one mutex, and this is the whole locking design:
//!
//! ```text
//! LOCK ORDER: operation gate -> published (RwLock)
//!             nothing ever takes them in the other order
//! ```
//!
//! Every mutation holds the gate for its **entire** duration, and every
//! scan-and-publish holds it too. Two properties follow, and both are needed:
//!
//! * A reconcile cannot observe a mutation's transient state. A delete moves a
//!   bookmark and then its assets; a scan between those two steps would publish
//!   a tree in which the bookmark has vanished and the assets have not, and a
//!   watcher would happily broadcast it as a change.
//! * Publishes are totally ordered by the moment their scan ran, so a slow scan
//!   can never land after a newer one and silently revert the served tree.
//!
//! Reads never take the gate: `GET /tree` clones the last published snapshot,
//! so a long mutation never blocks the UI.
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
use std::collections::{HashMap, HashSet};
use std::hash::{Hash as _, Hasher as _};
use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard};

use bbb_vault_core::{
    Access, BookmarkFile, BookmarkNode, BookmarkUpdate, ChildKind, FOLDER_FILE_NAME, FolderFile,
    FolderNode, FolderState, FolderUpdate, Id, NameAllocator, Revision, STATE_FILE_NAME,
    StateChild, UpdateError, VaultScan, assets_directory_name, render_bookmark, render_folder,
    scan,
};
use cap_fs_ext::DirExt as _;
use cap_std::fs::Dir;
use tokio::sync::broadcast;

use crate::clock;
use crate::dto::{self, BookmarkDto, Placement};
use crate::entry::EntryRef;
use crate::fsx;
use crate::problem::{Problem, ProblemCode};
use crate::staging::{Place, Staged};
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
    /// The one lock. Held for a whole mutation, and across every scan and the
    /// publish that follows it. See the module documentation.
    operation_gate: Mutex<()>,
    /// Entries a previous run left staged that recovery could not resolve.
    notices: Vec<crate::staging::Retained>,
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
    pub(crate) fn open_with_state(
        root: &Path,
        state: Dir,
        notices: Vec<crate::staging::Retained>,
    ) -> io::Result<Self> {
        let mut vault = Self::build(root, Some(state))?;
        vault.notices = notices;
        Ok(vault)
    }

    /// Problems the daemon itself has to report, beyond what the scan found.
    ///
    /// Currently: entries a previous run left staged that recovery could not
    /// restore or destroy. They are reported until a human resolves them.
    #[must_use]
    pub fn notices(&self) -> Vec<crate::dto::DiagnosticDto> {
        self.notices
            .iter()
            .map(|retained| crate::dto::DiagnosticDto {
                code: "staged_entries_retained".to_owned(),
                severity: "error".to_owned(),
                detail: retained.summary(),
                path: Some(retained.directory.clone()),
                line: None,
            })
            .collect()
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
            operation_gate: Mutex::new(()),
            notices: Vec::new(),
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
        let _gate = self.gate();
        self.reconcile_locked()
    }

    /// As [`Vault::reconcile`], for a caller that already holds the gate.
    fn reconcile_locked(&self) -> Result<(Snapshot, bool), Problem> {
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
        placement: &Placement,
    ) -> Result<BookmarkDto, Problem> {
        let _gate = self.gate();
        let scan = self.plan_scan()?;
        let parent_node = writable_folder(&scan, parent)?;
        let title = validated_title(title)?;

        let plan = self.plan_order(
            parent_node,
            placement.parent_state_revision.as_deref(),
            placement.index.is_some(),
        )?;
        let siblings = addressable_children(parent_node);
        let position = insertion_index(
            placement.index,
            siblings.len(),
            anchored_children(parent_node),
        )?;

        let parent_dir = self.dir_of(parent_node.relative_path())?;
        let parent_components = component_of(parent_node.relative_path())?;
        let id = fresh_id(&scan)?;
        let mut names = allocator_for(&parent_dir)?;
        let kind = if url.is_some() {
            ChildKind::Bookmark
        } else {
            ChildKind::Folder
        };

        // The entry and every order file it touches are one transaction. A
        // crash anywhere inside it is undone at the next start, so a create
        // never leaves an entry the caller was told did not happen.
        let mut staged = self.staging("create", id.as_str())?;

        let created = if let Some(url) = url {
            let url = validated_url(url)?;
            let now = clock::now_rfc3339();
            render_bookmark(id, url, title, &now, &now)
                .map_err(|e| update_problem(&e))
                .and_then(|document| {
                    create_bookmark_file(
                        &mut staged,
                        &parent_dir,
                        &parent_components,
                        &mut names,
                        title,
                        id,
                        document.as_bytes(),
                    )
                })
        } else {
            render_folder(id, Some(title))
                .map_err(|e| update_problem(&e))
                .and_then(|document| {
                    create_folder_directory(
                        &mut staged,
                        &parent_dir,
                        &parent_components,
                        &mut names,
                        title,
                        document.as_bytes(),
                    )
                })
        };
        let name = match created {
            Ok(name) => name,
            Err(problem) => return Err(rolled_back(staged, problem)),
        };

        let mut writes = Vec::new();
        if let OrderPlan::Write(order) = plan {
            let mut sequence = siblings;
            sequence.insert(position, (id, kind));
            let children = merge_order(&order.recorded, &sequence, &clock::now_rfc3339());
            writes.push((order, children));
        }

        // A folder the daemon creates gets its own empty order file in the same
        // transaction, so its first child can be placed without a migration
        // step first — and so a folder never exists in a state the next request
        // has to repair.
        if kind == ChildKind::Folder {
            match fsx::open_dir(&parent_dir, &name) {
                Ok(handle) => {
                    let mut components = parent_components.clone();
                    components.push(name.clone());
                    writes.push((
                        OrderFile {
                            handle,
                            components,
                            current: None,
                            recorded: Vec::new(),
                        },
                        Vec::new(),
                    ));
                }
                Err(error) => {
                    let problem = io_problem("the new folder could not be opened", &error);
                    return Err(rolled_back(staged, problem));
                }
            }
        }

        if let Err(problem) = write_orders(&mut staged, writes) {
            return Err(rolled_back(staged, problem));
        }
        staged
            .commit()
            .map_err(|error| io_problem("the change could not be completed", &error))?;

        self.settle(&EntryRef::Identity(id))
    }

    /// Replaces a folder's child order with `requested`.
    ///
    /// `requested` must name every direct child that has a stable identity,
    /// exactly once each, with the right kind. It is a complete permutation
    /// rather than a patch because a partial order has no single correct
    /// completion, and a client working from a stale tree would silently get a
    /// different one than it meant.
    ///
    /// A request that asks for the order the folder is already *recorded* in
    /// writes nothing at all, so it costs no revision and produces no change
    /// event. A folder that has no order file yet is a different case: the
    /// order it is displayed in is the migration order, nothing records it, and
    /// asking for exactly that order still writes the file that will keep it —
    /// which is a real change, and does advance the revision, once.
    ///
    /// # Errors
    ///
    /// [`ProblemCode::InvalidOrder`] when `requested` is not that permutation,
    /// [`ProblemCode::StaleStateRevision`] when `state_revision` no longer
    /// matches, and [`ProblemCode::StateReadOnly`] when the folder's order file
    /// holds something the daemon must not overwrite.
    pub fn set_order(
        &self,
        folder: &EntryRef,
        state_revision: Option<&str>,
        requested: &[(Id, ChildKind)],
    ) -> Result<BookmarkDto, Problem> {
        let _gate = self.gate();
        let scan = self.plan_scan()?;
        let node = writable_folder(&scan, folder)?;

        let plan = self.plan_order(node, state_revision, true)?;
        let OrderPlan::Write(order) = plan else {
            // `plan_order` refuses a positional request against a frozen
            // folder, so this is unreachable; refusing again is cheaper than
            // relying on that from a distance.
            return Err(frozen_problem());
        };

        let siblings = addressable_children(node);
        check_permutation(&siblings, requested)?;

        let children = merge_order(&order.recorded, requested, &clock::now_rfc3339());
        self.commit_orders("set_order", &folder.to_string(), vec![(order, children)])?;
        self.settle(folder)
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
        let scan = self.plan_scan()?;

        match locate(&scan, reference)? {
            Located::Bookmark(node) => {
                let title = title.map(validated_title).transpose()?;
                let url = url.map(validated_url).transpose()?;
                require_writable(node.access(), "the bookmark")?;
                let origin = component_path(node.relative_path())?;
                let dir = self.parent_dir_of(node.relative_path())?;
                update_bookmark(self, &dir, &origin, node.file_name(), expected, title, url)?;
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
                let origin =
                    fsx::component::split(node.relative_path()).map_err(|(part, error)| {
                        Problem::new(
                            ProblemCode::VaultUnavailable,
                            format!("`{part}` is not a usable path component: {error}"),
                        )
                    })?;
                let dir = self.dir_of(node.relative_path())?;
                update_folder(self, &dir, &origin, expected, title)?;
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
    pub fn delete_bookmark(
        &self,
        reference: &EntryRef,
        revision: &str,
        parent_state_revision: Option<&str>,
    ) -> Result<(), Problem> {
        let _gate = self.gate();
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
        let parent_components = component_path(node.relative_path())?;
        let dir = self.parent_dir_of(node.relative_path())?;

        // The bytes and the file's identity come from one handle, so the
        // revision check and the removal are about the same object. The entry's
        // own revision is checked before the parent's order revision, so a
        // request that is stale about both is told about the entry — which is
        // what it was actually asking to change.
        let validated = read_validated(&dir, node.file_name())?;
        check_revision(expected, validated.revision())?;
        let removal = self.plan_removal(
            &scan,
            node.relative_path(),
            Some(node.id()),
            parent_state_revision,
        )?;

        let assets = assets_directory_name(node.file_name());
        let assets_identity = fsx::open_dir(&dir, &assets)
            .ok()
            .and_then(|handle| fsx::directory_identity(&handle).ok());

        let mut staged = self.staging("delete_bookmark", node.id().as_str())?;

        // The claim itself checks the identity at the moment it lands, so there
        // is no gap between confirming and taking: an entry replaced in between
        // is put straight back and reported.
        if let Err(error) = staged.take(
            &dir,
            &parent_components,
            node.file_name(),
            false,
            validated.identity,
        ) {
            return Err(take_problem(staged, "the bookmark", error));
        }
        if let Some(identity) = assets_identity
            && let Err(error) = staged.take(&dir, &parent_components, &assets, true, identity)
        {
            return Err(take_problem(staged, "the bookmark's assets", error));
        }

        if let Some((order, children)) = removal
            && let Err(problem) = write_orders(&mut staged, vec![(order, children)])
        {
            let _ = staged.rollback();
            return Err(problem);
        }

        staged
            .commit()
            .map_err(|error| io_problem("the staged entries could not be destroyed", &error))?;
        self.reconcile_locked()?;
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
        parent_state_revision: Option<&str>,
        recursive: bool,
    ) -> Result<(), Problem> {
        let _gate = self.gate();
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
        let removal = self.plan_removal(
            &scan,
            node.relative_path(),
            node.id(),
            parent_state_revision,
        )?;

        // The identity of the directory that is about to be verified. The
        // staging rename below names a directory *entry*, and an entry can be
        // repointed; this is what proves the entry still leads to the tree that
        // was actually checked.
        let verified = fsx::directory_identity(&handle)
            .map_err(|error| io_problem("the folder could not be identified", &error))?;

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

        let parent_components = component_path(node.relative_path())?;
        let parent = self.parent_dir_of(node.relative_path())?;

        let staging_id = node
            .id()
            .map_or_else(|| "folder".to_owned(), |id| id.as_str().to_owned());
        let mut staged = self.staging("delete_folder", &staging_id)?;

        // Bound to the identity of the directory whose contents were verified.
        // If the entry now leads somewhere else, that somewhere else is put
        // back untouched and the delete is refused.
        if let Err(error) = staged.take(
            &parent,
            &parent_components,
            node.directory_name(),
            true,
            verified,
        ) {
            return Err(match error {
                crate::staging::TakeError::NotTheSameEntry => Problem::new(
                    ProblemCode::SubtreeChanged,
                    "the folder was replaced on disk after its contents were checked; the \
                     replacement has been left untouched. Rescan and retry",
                ),
                other => take_problem(staged, "the folder", other),
            });
        }

        if let Some((order, children)) = removal
            && let Err(problem) = write_orders(&mut staged, vec![(order, children)])
        {
            let _ = staged.rollback();
            return Err(problem);
        }

        staged
            .commit()
            .map_err(|error| io_problem("the staged folder could not be destroyed", &error))?;
        self.reconcile_locked()?;
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
        request: &MovePlan,
    ) -> Result<BookmarkDto, Problem> {
        let _gate = self.gate();
        let expected = parse_revision(&request.revision)?;
        let scan = self.plan_scan()?;
        let destination_node = writable_folder(&scan, &request.parent)?;

        let Movable {
            id,
            kind,
            origin,
            file_name,
        } = movable(&scan, reference, destination_node)?;

        let source_path = parent_path(&origin).to_owned();
        let same_parent = source_path == destination_node.relative_path();
        let source_node = folder_at(scan.folder(), &source_path).ok_or_else(|| {
            Problem::new(
                ProblemCode::VaultUnavailable,
                "the folder the entry is in could not be resolved",
            )
        })?;

        // The entry's own revision is checked against the file the move will
        // actually rename, exactly as before ordering existed.
        match kind {
            ChildKind::Bookmark => {
                let source = self.dir_of(&source_path)?;
                check_revision(expected, revision_of(&source, &file_name)?)?;
            }
            ChildKind::Folder => {
                let handle = self.dir_of(&origin)?;
                check_revision(expected, revision_of(&handle, FOLDER_FILE_NAME)?)?;
            }
        }

        let (source_revision, destination_revision) = request.revisions(same_parent)?;
        let positional = request.index.is_some();
        let destination_plan =
            self.plan_order(destination_node, destination_revision, positional)?;
        let source_plan = if same_parent {
            OrderPlan::Frozen
        } else {
            self.plan_order(source_node, source_revision, false)?
        };

        let destination_siblings = addressable_children(destination_node);
        let mut sequence: Vec<(Id, ChildKind)> = destination_siblings
            .iter()
            .copied()
            .filter(|(other, _)| !same_parent || *other != id)
            .collect();
        let position = insertion_index(
            request.index,
            sequence.len(),
            anchored_children(destination_node),
        )?;

        sequence.insert(position, (id, kind));
        let now = clock::now_rfc3339();

        // Same-parent is purely positional: nothing on disk moves, and if the
        // order is already the requested one the change writes nothing at all.
        if same_parent {
            let mut writes = Vec::new();
            if let OrderPlan::Write(order) = destination_plan {
                let children = merge_order(&order.recorded, &sequence, &now);
                writes.push((order, children));
            }
            self.commit_orders("move", id.as_str(), writes)?;
            return self.settle(reference);
        }

        self.relocate_entry(
            &scan,
            reference,
            RelocatePlan {
                id,
                source: &source_path,
                destination: destination_node,
                source_node,
                destination_plan,
                source_plan,
                sequence: &sequence,
                now: &now,
            },
        )?;

        self.settle(reference)
    }

    /// Carries out a move between two folders as one transaction.
    ///
    /// The rename — and a bookmark's assets with it — and both order files are
    /// recorded in one manifest, so a crash anywhere inside is undone at the
    /// next start rather than leaving an entry in one folder and two orders
    /// disagreeing about where it is.
    fn relocate_entry(
        &self,
        scan: &VaultScan,
        reference: &EntryRef,
        plan: RelocatePlan<'_>,
    ) -> Result<(), Problem> {
        let mut staged = self.staging("move", plan.id.as_str())?;
        let source = self.dir_of(plan.source)?;
        let source_components = component_of(plan.source)?;
        let destination = self.dir_of(plan.destination.relative_path())?;
        let destination_components = component_of(plan.destination.relative_path())?;

        let relocated = match locate(scan, reference)? {
            Located::Bookmark(node) => move_bookmark(
                &mut staged,
                &source,
                &source_components,
                node,
                &destination,
                &destination_components,
            ),
            Located::Folder(node) => move_folder(
                &mut staged,
                &source,
                &source_components,
                node,
                &destination,
                &destination_components,
            ),
        };
        if let Err(problem) = relocated {
            return Err(rolled_back(staged, problem));
        }

        let mut writes = Vec::new();
        if let OrderPlan::Write(order) = plan.destination_plan {
            let children = merge_order(&order.recorded, plan.sequence, plan.now);
            writes.push((order, children));
        }
        if let OrderPlan::Write(order) = plan.source_plan {
            let recorded = without(&order.recorded, plan.id);
            let remaining: Vec<(Id, ChildKind)> = addressable_children(plan.source_node)
                .into_iter()
                .filter(|(other, _)| *other != plan.id)
                .collect();
            let children = merge_order(&recorded, &remaining, plan.now);
            writes.push((order, children));
        }

        if let Err(problem) = write_orders(&mut staged, writes) {
            return Err(rolled_back(staged, problem));
        }
        staged
            .commit()
            .map_err(|error| io_problem("the change could not be completed", &error))
    }

    // -- child order ------------------------------------------------------

    /// Decides how one folder's recorded order should be treated.
    ///
    /// `positional` says whether the request actually depends on placement. A
    /// folder whose order file the daemon must not overwrite can still gain and
    /// lose entries — the file simply stops describing them, and the scan
    /// appends them — but it cannot be told *where* they go, so a request that
    /// says where is refused rather than quietly ignored.
    fn plan_order(
        &self,
        node: &FolderNode,
        supplied: Option<&str>,
        positional: bool,
    ) -> Result<OrderPlan, Problem> {
        // Writability is decided first, so a folder whose order file must not
        // be overwritten answers `state_read_only` straight away. Answering
        // `stale_state_revision` there would send a client to reload a revision
        // that cannot help it, and it would be told the same thing again.
        if !node.state_access().is_writable() {
            if positional {
                return Err(frozen_problem());
            }
            check_state_revision(node, supplied, false)?;
            return Ok(OrderPlan::Frozen);
        }
        check_state_revision(node, supplied, positional)?;
        Ok(OrderPlan::Write(self.open_order(node)?))
    }

    /// Opens a folder's order file for writing, reading what it currently says.
    ///
    /// The bytes and the file's identity come from one handle, so the write is
    /// bound to the exact file that was read — the same rule every other
    /// mutation in this module follows.
    fn open_order(&self, node: &FolderNode) -> Result<OrderFile, Problem> {
        let handle = self.dir_of(node.relative_path())?;
        let components = component_of(node.relative_path())?;

        if node.state_revision().is_none() {
            return Ok(OrderFile {
                handle,
                components,
                current: None,
                recorded: Vec::new(),
            });
        }

        let current = read_validated(&handle, STATE_FILE_NAME)?;
        let (state, freeze) = FolderState::parse(&current.bytes).map_err(|error| {
            // The scan read it a moment ago and found it usable, so this is a
            // change since then rather than a permanent condition.
            Problem::new(
                ProblemCode::StaleStateRevision,
                format!("{error}; rescan and retry"),
            )
        })?;
        if freeze.is_some() {
            return Err(frozen_problem());
        }
        Ok(OrderFile {
            handle,
            components,
            current: Some(current),
            recorded: state.children().to_vec(),
        })
    }

    /// Plans the parent's order change for an entry that is about to go away.
    fn plan_removal(
        &self,
        scan: &VaultScan,
        relative_path: &str,
        id: Option<Id>,
        supplied: Option<&str>,
    ) -> Result<Option<(OrderFile, Vec<StateChild>)>, Problem> {
        let parent = folder_at(scan.folder(), parent_path(relative_path)).ok_or_else(|| {
            Problem::new(
                ProblemCode::VaultUnavailable,
                "the folder the entry is in could not be resolved",
            )
        })?;
        // Removing an entry is not a positional request: it never says where
        // anything goes, so a frozen order file does not block it.
        let OrderPlan::Write(order) = self.plan_order(parent, supplied, false)? else {
            return Ok(None);
        };

        let Some(id) = id else {
            return Ok(None);
        };
        let recorded = without(&order.recorded, id);
        let remaining: Vec<(Id, ChildKind)> = addressable_children(parent)
            .into_iter()
            .filter(|(other, _)| *other != id)
            .collect();
        let children = merge_order(&recorded, &remaining, &clock::now_rfc3339());
        Ok(Some((order, children)))
    }

    /// Applies a set of order writes in one durable transaction.
    ///
    /// A write that would produce the bytes already on disk is dropped, and a
    /// call with nothing left to do opens no staging area at all. That is what
    /// makes reordering a folder into the order it is already recorded in cost
    /// nothing: no write, no revision change, no event.
    ///
    /// It does not apply to a folder with no order file yet. There is nothing
    /// on disk for the new bytes to match, so the first change to such a folder
    /// always writes — that write is the bootstrap, and it is what makes every
    /// later no-op free.
    fn commit_orders(
        &self,
        operation: &str,
        id: &str,
        writes: Vec<(OrderFile, Vec<StateChild>)>,
    ) -> Result<(), Problem> {
        let writes: Vec<(OrderFile, Vec<StateChild>)> = writes
            .into_iter()
            .filter(|(order, children)| !order.is_noop(children))
            .collect();
        if writes.is_empty() {
            return Ok(());
        }

        let mut staged = self.staging(operation, id)?;
        if let Err(problem) = write_orders(&mut staged, writes) {
            let _ = staged.rollback();
            return Err(problem);
        }
        staged
            .commit()
            .map_err(|error| io_problem("the change could not be completed", &error))
    }

    // -- internals --------------------------------------------------------

    /// Rescues a stranded temporary that holds the user's evicted bytes.
    ///
    /// Returns a sentence for the caller's error message describing where the
    /// bytes are now. Nothing is ever deleted on this path.
    fn rescue(&self, dir: &Dir, origin: &[String], name: &str, temporary: &str) -> String {
        let Some(state) = self.state.as_ref() else {
            return format!("they remain in `{temporary}`, beside the entry");
        };
        crate::staging::rescue(state, &self.root, dir, origin, name, temporary)
    }

    /// Opens a staging area for one operation.
    fn staging(&self, operation: &str, id: &str) -> Result<Staged, Problem> {
        let state = self.state.as_ref().ok_or_else(|| {
            Problem::new(
                ProblemCode::VaultUnavailable,
                "this vault was opened for reading only",
            )
        })?;
        Staged::open(state, &self.root, operation, id)
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

    /// Takes the one lock. See the module documentation for the order.
    fn gate(&self) -> MutexGuard<'_, ()> {
        self.operation_gate
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
    /// The caller already holds the gate, so this cannot observe another
    /// mutation's half-finished state.
    fn plan_scan(&self) -> Result<VaultScan, Problem> {
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
        let (snapshot, _) = self.reconcile_locked()?;
        let located = locate(&snapshot.scan, reference)?;
        Ok(located.to_dto(&snapshot.scan))
    }
}

/// What a move needs to know about the entry it is about.
struct Movable {
    /// Its stable identity.
    id: Id,
    /// Whether it is a bookmark or a folder.
    kind: ChildKind,
    /// Its vault-relative path before the move.
    origin: String,
    /// Its on-disk name, which the move tries to keep.
    file_name: String,
}

/// Resolves the entry a move is about, refusing the ones that cannot move.
fn movable(
    scan: &VaultScan,
    reference: &EntryRef,
    destination: &FolderNode,
) -> Result<Movable, Problem> {
    match locate(scan, reference)? {
        Located::Bookmark(node) => {
            require_writable(node.access(), "the bookmark")?;
            Ok(Movable {
                id: node.id(),
                kind: ChildKind::Bookmark,
                origin: node.relative_path().to_owned(),
                file_name: node.file_name().to_owned(),
            })
        }
        Located::Folder(node) => {
            if node.relative_path().is_empty() {
                return Err(Problem::new(
                    ProblemCode::InvalidValue,
                    "the vault root cannot be moved",
                ));
            }
            require_writable(node.access(), "the folder")?;
            guard_move_into_self(node, destination)?;
            let id = node.id().ok_or_else(|| {
                Problem::new(
                    ProblemCode::ReadOnly,
                    format!(
                        "the directory has no `{FOLDER_FILE_NAME}`, so it has no stable identity \
                         and cannot be moved"
                    ),
                )
            })?;
            Ok(Movable {
                id,
                kind: ChildKind::Folder,
                origin: node.relative_path().to_owned(),
                file_name: node.directory_name().to_owned(),
            })
        }
    }
}

/// Everything a move needs to know beyond which entry it is about.
#[derive(Debug, Clone)]
pub struct MovePlan {
    /// The revision of the entry itself.
    pub revision: String,
    /// The folder it should end up in.
    pub parent: EntryRef,
    /// Where among that folder's children; the end when absent.
    pub index: Option<usize>,
    /// The revision of the order file of the folder it is leaving.
    pub source_state_revision: Option<String>,
    /// The revision of the order file of the folder it is joining.
    pub destination_state_revision: Option<String>,
}

impl MovePlan {
    /// The source and destination order revisions this request carries.
    ///
    /// A move within one folder touches one order file, so it carries one
    /// revision — under either name, since both name the same file. Sending two
    /// different values for it is a request that cannot be satisfied, and is
    /// refused rather than resolved by preferring one.
    fn revisions(&self, same_parent: bool) -> Result<(Option<&str>, Option<&str>), Problem> {
        let source = self.source_state_revision.as_deref();
        let destination = self.destination_state_revision.as_deref();
        if !same_parent {
            return Ok((source, destination));
        }
        match (source, destination) {
            (Some(source), Some(destination)) if source != destination => Err(Problem::new(
                ProblemCode::InvalidRequest,
                "this move stays in one folder, so sourceStateRevision and \
                 destinationStateRevision name the same file and must match",
            )),
            (one, other) => {
                let single = one.or(other);
                Ok((single, single))
            }
        }
    }
}

/// Everything [`Vault::relocate_entry`] needs, bundled so the signature stays
/// readable.
struct RelocatePlan<'a> {
    /// The entry's identity.
    id: Id,
    /// The vault-relative path of the folder it is leaving.
    source: &'a str,
    /// The folder it is joining.
    destination: &'a FolderNode,
    /// The folder it is leaving.
    source_node: &'a FolderNode,
    /// What to do with the destination's order file.
    destination_plan: OrderPlan,
    /// What to do with the source's order file.
    source_plan: OrderPlan,
    /// The destination's children, with the entry already in its new place.
    sequence: &'a [(Id, ChildKind)],
    /// The timestamp any newly recorded membership is stamped with.
    now: &'a str,
}

/// How a mutation should treat one folder's recorded child order.
#[derive(Debug)]
enum OrderPlan {
    /// Rewrite the folder's order file as part of the change.
    Write(OrderFile),
    /// Leave the order file alone; the scan will place the entry itself.
    Frozen,
}

/// One folder's order file, opened for a change.
#[derive(Debug)]
struct OrderFile {
    /// The folder's own directory handle.
    handle: Dir,
    /// The folder's vault-relative path, as validated components.
    components: Vec<String>,
    /// The order file as it is right now, absent when there is none yet.
    current: Option<fsx::Validated>,
    /// What it currently records.
    recorded: Vec<StateChild>,
}

impl OrderFile {
    /// Whether writing `children` would change a single byte.
    fn is_noop(&self, children: &[StateChild]) -> bool {
        self.current
            .as_ref()
            .is_some_and(|current| current.bytes == FolderState::new(children.to_vec()).render())
    }
}

/// Writes every planned order change into one transaction.
fn write_orders(
    staged: &mut Staged,
    writes: Vec<(OrderFile, Vec<StateChild>)>,
) -> Result<(), Problem> {
    for (order, children) in writes {
        let bytes = FolderState::new(children).render();
        staged
            .write_state(
                &order.handle,
                &order.components,
                &bytes,
                order.current.as_ref(),
            )
            .map_err(|error| match error.kind() {
                io::ErrorKind::AlreadyExists => Problem::new(
                    ProblemCode::StaleStateRevision,
                    "the folder's child order changed while this change was being written; \
                     reload it and retry",
                ),
                _ => io_problem("the folder's child order could not be written", &error),
            })?;
    }
    Ok(())
}

/// The folder's children that an order file is able to name, in display order.
///
/// A directory with no `.bbb-folder.md` has no stable identity, so nothing can
/// record where it goes; it is left out here and the scan appends it. Two
/// entries claiming one identity are equally unnameable, so only the first is
/// kept — the duplicate is already reported as an error and is read-only.
fn addressable_children(node: &FolderNode) -> Vec<(Id, ChildKind)> {
    let mut seen = HashSet::new();
    node.children()
        .iter()
        .filter_map(|child| child.id().map(|id| (id, child.kind())))
        .filter(|(id, _)| seen.insert(*id))
        .collect()
}

/// Rewrites a recorded order so that the children in `sequence` appear in that
/// order, and everything else the file remembers is kept where it was.
///
/// The second half is the part that matters. A file the order names but the
/// folder does not currently hold is very often one a sync client has not
/// delivered yet, so it is never pruned — but simply appending it would move it
/// to the end of a list the user arranged. Instead each such reference is
/// anchored to the child it followed, and reappears in the same place. A
/// reference the caller means to drop is removed from `recorded` before this is
/// called; nothing is dropped here.
fn merge_order(
    recorded: &[StateChild],
    sequence: &[(Id, ChildKind)],
    now: &str,
) -> Vec<StateChild> {
    let present: HashSet<Id> = sequence.iter().map(|(id, _)| *id).collect();
    let known: HashMap<Id, &StateChild> =
        recorded.iter().map(|child| (child.id(), child)).collect();

    let mut leading: Vec<StateChild> = Vec::new();
    let mut trailing: HashMap<Id, Vec<StateChild>> = HashMap::new();
    let mut anchor: Option<Id> = None;
    for child in recorded {
        if present.contains(&child.id()) {
            anchor = Some(child.id());
        } else {
            match anchor {
                None => leading.push(child.clone()),
                Some(id) => trailing.entry(id).or_default().push(child.clone()),
            }
        }
    }

    let mut out = leading;
    for (id, kind) in sequence {
        // The recorded `addedAt` is kept: it is when the entry joined this
        // folder, and reordering is not joining it again.
        let child = known
            .get(id)
            .filter(|child| child.kind() == *kind)
            .map_or_else(
                || StateChild::new(*id, *kind, now),
                |child| (*child).clone(),
            );
        out.push(child);
        out.extend(trailing.remove(id).unwrap_or_default());
    }
    out
}

/// The recorded order with `id` taken out of it.
fn without(recorded: &[StateChild], id: Id) -> Vec<StateChild> {
    recorded
        .iter()
        .filter(|child| child.id() != id)
        .cloned()
        .collect()
}

/// Checks a requested order names every addressable child exactly once.
fn check_permutation(
    siblings: &[(Id, ChildKind)],
    requested: &[(Id, ChildKind)],
) -> Result<(), Problem> {
    let mut expected: HashMap<Id, ChildKind> =
        siblings.iter().map(|(id, kind)| (*id, *kind)).collect();

    for (id, kind) in requested {
        match expected.remove(id) {
            Some(actual) if actual == *kind => {}
            Some(actual) => {
                return Err(Problem::new(
                    ProblemCode::InvalidOrder,
                    format!("`{id}` is a {actual} in this folder, not a {kind}"),
                ));
            }
            None => {
                return Err(Problem::new(
                    ProblemCode::InvalidOrder,
                    format!(
                        "`{id}` is not a child of this folder, or is named more than once; a \
                         child order must list every child exactly once"
                    ),
                ));
            }
        }
    }

    if let Some(id) = expected.keys().min() {
        return Err(Problem::new(
            ProblemCode::InvalidOrder,
            format!(
                "the child order leaves out `{id}`; it must list every child of this folder \
                 exactly once"
            ),
        ));
    }
    Ok(())
}

/// Resolves a requested insertion point against the folder's children.
///
/// `index` counts the list a client is looking at, and it can: every child an
/// order file is able to name comes first in that list, and the directories it
/// cannot name form a stable block at the end. So positions `0..=orderable` are
/// exactly the ones in the addressable part, and a position inside the trailing
/// block is refused by name rather than quietly turning into a different one.
fn insertion_index(
    index: Option<usize>,
    orderable: usize,
    anchored: usize,
) -> Result<usize, Problem> {
    match index {
        None => Ok(orderable),
        // `orderable` is the end of the addressable part, which is a legitimate
        // place to insert.
        Some(index) if index <= orderable => Ok(index),
        Some(index) if anchored > 0 => Err(Problem::new(
            ProblemCode::InvalidOrder,
            format!(
                "index {index} falls inside the {anchored} {} at the end of this folder that have \
                 no `{FOLDER_FILE_NAME}`. Nothing can record where those go, so they always come \
                 last and nothing can be placed after them; the last position that can be \
                 recorded is {orderable}",
                if anchored == 1 {
                    "directory"
                } else {
                    "directories"
                }
            ),
        )),
        Some(index) => Err(Problem::new(
            ProblemCode::InvalidOrder,
            format!("index {index} is past the end of a folder with {orderable} children"),
        )),
    }
}

/// How many children of `node` no order file can ever name.
fn anchored_children(node: &FolderNode) -> usize {
    node.children()
        .iter()
        .filter(|child| child.id().is_none())
        .count()
}

/// Checks that a request was looking at the folder's current order.
/// Checks that a request was looking at the folder's current order.
///
/// A revision that *is* sent is always checked strictly, whatever the request
/// is: a client that says which order it saw is held to it.
///
/// Omitting it is allowed only for a request whose outcome does not depend on
/// the order at all — appending, or removing a child by identity. Those mean
/// the same thing however the folder is currently arranged, so the daemon
/// resolves the current revision itself, under the operation gate, and nothing
/// can slip in between. It is what keeps a client written before ordering
/// existed working unchanged.
///
/// A `positional` request is the opposite: an index or a permutation only means
/// something against a particular arrangement, so one has to be named.
fn check_state_revision(
    node: &FolderNode,
    supplied: Option<&str>,
    positional: bool,
) -> Result<(), Problem> {
    match (node.state_revision(), supplied) {
        (_, Some(supplied)) => {
            let supplied = Revision::from_hex(supplied).ok_or_else(|| {
                Problem::new(
                    ProblemCode::InvalidRequest,
                    "a state revision is 64 lowercase hexadecimal characters",
                )
            })?;
            match node.state_revision() {
                Some(expected) if expected == supplied => Ok(()),
                Some(expected) => Err(Problem::new(
                    ProblemCode::StaleStateRevision,
                    format!(
                        "the folder's child order changed: expected {expected}, was sent \
                         {supplied}. Reload the folder and retry"
                    ),
                )),
                None => Err(Problem::new(
                    ProblemCode::StaleStateRevision,
                    "this folder has no child order file, so no stateRevision may be sent; \
                     reload the folder and retry",
                )),
            }
        }
        (_, None) if !positional => Ok(()),
        (Some(_), None) => Err(Problem::new(
            ProblemCode::StaleStateRevision,
            "this request places an entry at a position, which only means something against a \
             particular order, so this folder's current stateRevision must be sent with it",
        )),
        (None, None) => Ok(()),
    }
}

/// Undoes a change that could not be finished, and reports why it stopped.
///
/// The rollback failing is the more serious of the two things that just went
/// wrong, so it takes over the message: the caller needs to know the vault is
/// not as it was, and `bbb doctor` needs to be the next thing they run.
fn rolled_back(staged: Staged, problem: Problem) -> Problem {
    match staged.rollback() {
        Ok(()) => problem,
        Err(error) => Problem::new(
            ProblemCode::PartialFailure,
            format!(
                "{}, and undoing what had already been done failed as well ({error}); nothing \
                 was discarded — run `bbb doctor` and see .bbb/staging/recovery.txt",
                problem.detail()
            ),
        ),
    }
}

fn frozen_problem() -> Problem {
    Problem::new(
        ProblemCode::StateReadOnly,
        "this folder's child order file holds something this build must not overwrite, so its \
         order cannot be changed. The folder's diagnostics say what, and entries can still be \
         created, renamed, moved and deleted meanwhile",
    )
}

/// Creates a bookmark file, retrying if a name is claimed underneath us.
///
/// Returns the name it settled on, which is what an undo has to remove.
fn create_bookmark_file(
    staged: &mut Staged,
    parent: &Dir,
    parent_components: &[String],
    names: &mut NameAllocator,
    title: &str,
    id: Id,
    document: &[u8],
) -> Result<String, Problem> {
    for _ in 0..NAME_ATTEMPTS {
        let name = names.allocate_bookmark(title, id);
        // Recorded in the change's manifest before it exists, so an interrupted
        // run removes it again rather than leaving an entry nobody asked for.
        match staged.create_file(parent, parent_components, &name, document) {
            Ok(()) => return Ok(name),
            // Something claimed the name between listing the directory and
            // creating the file. `create_new` caught it, so take the next name
            // the allocator offers rather than overwriting anything.
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(io_problem("the bookmark could not be written", &error)),
        }
    }
    Err(name_exhausted())
}

/// Creates a folder directory and its metadata, undoing the first on failure.
///
/// Returns the directory name it settled on.
fn create_folder_directory(
    staged: &mut Staged,
    parent: &Dir,
    parent_components: &[String],
    names: &mut NameAllocator,
    title: &str,
    document: &[u8],
) -> Result<String, Problem> {
    for _ in 0..NAME_ATTEMPTS {
        let name = names.allocate_folder(title);
        match staged.create_directory(parent, parent_components, &name) {
            Ok(()) => {
                let child = parent
                    .open_dir_nofollow(&name)
                    .map_err(|error| io_problem("the new folder could not be opened", &error))?;
                // Recorded in its own right, rather than left for the undo of
                // the directory to sweep up. An undo will not delete a directory
                // that still holds anything — a filename is not evidence of who
                // wrote it, so "it only contains our metadata" is not a claim it
                // can make — and the way to leave a directory that really is ours
                // empty is for everything inside it to be undone first.
                let mut child_components = parent_components.to_vec();
                child_components.push(name.clone());
                return match staged.create_file(
                    &child,
                    &child_components,
                    FOLDER_FILE_NAME,
                    document,
                ) {
                    Ok(()) => Ok(name),
                    Err(error) => Err(io_problem(
                        "the folder metadata could not be written",
                        &error,
                    )),
                };
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(io_problem("the folder could not be created", &error)),
        }
    }
    Err(name_exhausted())
}

/// Applies a title and URL change to one bookmark file.
///
/// The bytes and the file's identity are read from one handle, and the commit
/// is bound to both: if the name comes to mean a different file before the new
/// content lands, the write is refused as stale and that file is left exactly
/// as it is. See [`crate::fsx::replace_validated`].
fn update_bookmark(
    vault: &Vault,
    dir: &Dir,
    origin: &[String],
    name: &str,
    expected: Revision,
    title: Option<&str>,
    url: Option<&str>,
) -> Result<(), Problem> {
    let validated = read_validated(dir, name)?;
    check_revision(expected, validated.revision())?;
    let source = &validated.bytes;

    let file = BookmarkFile::parse(source).map_err(|error| {
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
        .apply(source, &requested(None))
        .map_err(|e| update_problem(&e))?;
    if probe == *source {
        return Ok(());
    }

    let now = clock::now_rfc3339();
    let bytes = file
        .apply(source, &requested(Some(&now)))
        .map_err(|e| update_problem(&e))?;
    fsx::replace_validated(dir, name, &bytes, &validated).map_err(|error| {
        commit_problem(
            vault,
            dir,
            origin,
            name,
            "the bookmark could not be written",
            error,
        )
    })
}

/// Applies a title change to one `.bbb-folder.md`, bound to its identity.
fn update_folder(
    vault: &Vault,
    dir: &Dir,
    origin: &[String],
    expected: Revision,
    title: Option<&str>,
) -> Result<(), Problem> {
    let validated = read_validated(dir, FOLDER_FILE_NAME)?;
    check_revision(expected, validated.revision())?;
    let source = &validated.bytes;

    let file = FolderFile::parse(source).map_err(|error| {
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
        .apply(source, &update)
        .map_err(|e| update_problem(&e))?;
    if bytes == *source {
        return Ok(());
    }
    fsx::replace_validated(dir, FOLDER_FILE_NAME, &bytes, &validated).map_err(|error| {
        commit_problem(
            vault,
            dir,
            origin,
            FOLDER_FILE_NAME,
            "the folder metadata could not be written",
            error,
        )
    })
}

/// Renames a bookmark into `destination`, taking its assets with it.
///
/// Both renames are recorded in the change's manifest before they happen, so an
/// interruption between them is undone rather than leaving the pair split
/// across two folders. The caller rolls the change back on any error.
fn move_bookmark(
    staged: &mut Staged,
    source: &Dir,
    source_components: &[String],
    node: &BookmarkNode,
    destination: &Dir,
    destination_components: &[String],
) -> Result<(), Problem> {
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
        match staged.relocate(
            Place {
                dir: source,
                components: source_components,
                name: node.file_name(),
            },
            Place {
                dir: destination,
                components: destination_components,
                name: &candidate,
            },
            false,
        ) {
            Ok(()) => {
                if !has_assets {
                    return Ok(());
                }
                let target = assets_directory_name(&candidate);
                return staged
                    .relocate(
                        Place {
                            dir: source,
                            components: source_components,
                            name: &assets,
                        },
                        Place {
                            dir: destination,
                            components: destination_components,
                            name: &target,
                        },
                        true,
                    )
                    .map_err(|error| {
                        io_problem("the bookmark's assets could not be moved", &error)
                    });
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

/// Renames a directory into `destination`, recording it in the change first.
fn move_folder(
    staged: &mut Staged,
    source: &Dir,
    source_components: &[String],
    node: &FolderNode,
    destination: &Dir,
    destination_components: &[String],
) -> Result<(), Problem> {
    let mut names = allocator_for(destination)?;
    let mut candidate = if names.reserve(node.directory_name()) {
        node.directory_name().to_owned()
    } else {
        names.allocate_folder(node.title())
    };

    for attempt in 0..NAME_ATTEMPTS {
        match staged.relocate(
            Place {
                dir: source,
                components: source_components,
                name: node.directory_name(),
            },
            Place {
                dir: destination,
                components: destination_components,
                name: &candidate,
            },
            true,
        ) {
            Ok(()) => return Ok(()),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {
                if attempt + 1 == NAME_ATTEMPTS {
                    break;
                }
                candidate = names.allocate_folder(node.title());
            }
            Err(error) if error.kind() == io::ErrorKind::Unsupported => {
                return Err(unsupported_folder_move());
            }
            Err(error) => return Err(io_problem("the folder could not be moved", &error)),
        }
    }
    Err(name_exhausted())
}

/// The refusal on a platform with no no-replace directory rename.
fn unsupported_folder_move() -> Problem {
    Problem::new(
        ProblemCode::UnsupportedOperation,
        "moving a folder needs a rename this platform cannot perform without risking the \
         destruction of whatever is already at the destination, so it is refused. Move the \
         directory in a file manager and rescan",
    )
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
        // The two machine-managed files are the folder's own bookkeeping, not
        // things it contains, so an otherwise empty folder still deletes
        // without `recursive`.
        if entry.file_name() != FOLDER_FILE_NAME && entry.file_name() != STATE_FILE_NAME {
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

/// Reads an entry together with the identity of the file it came from.
fn read_validated(dir: &Dir, name: &str) -> Result<fsx::Validated, Problem> {
    fsx::read_with_identity(dir, name).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => Problem::new(
            ProblemCode::NotFound,
            "the entry is no longer on disk; rescan and retry",
        ),
        _ => io_problem("the entry could not be read", &error),
    })
}

/// Turns a bound-commit failure into the right refusal.
///
/// The undo-failure case is the delicate one: the temporary named there holds
/// the *user's* evicted file, so it is rescued into staging rather than left as
/// a dot-file nobody will ever notice, and never deleted.
fn commit_problem(
    vault: &Vault,
    dir: &Dir,
    origin: &[String],
    name: &str,
    context: &str,
    error: fsx::CommitError,
) -> Problem {
    match error {
        fsx::CommitError::Stale => Problem::new(
            ProblemCode::StaleRevision,
            "the entry was replaced on disk while this change was being written; the replacement \
             has been left untouched. Reload it and reapply the change",
        ),
        fsx::CommitError::Io(error) => io_problem(context, &error),
        fsx::CommitError::UndoFailed { temporary, cause } => {
            let rescued = vault.rescue(dir, origin, name, &temporary);
            Problem::new(
                ProblemCode::PartialFailure,
                format!(
                    "{context} ({}), and the previous contents could not be put back. They have \
                     not been deleted: {rescued}",
                    cause.kind()
                ),
            )
        }
    }
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

/// The vault-relative parent of `relative`, as validated components.
fn component_path(relative: &str) -> Result<Vec<String>, Problem> {
    component_of(parent_path(relative))
}

/// `relative` itself, as validated components.
fn component_of(relative: &str) -> Result<Vec<String>, Problem> {
    fsx::component::split(relative).map_err(|(part, error)| {
        Problem::new(
            ProblemCode::VaultUnavailable,
            format!("`{part}` is not a usable path component: {error}"),
        )
    })
}

/// Turns a failed staging claim into the right refusal, rolling back the rest.
fn take_problem(staged: Staged, subject: &str, error: crate::staging::TakeError) -> Problem {
    match error {
        crate::staging::TakeError::NotTheSameEntry => {
            let _ = staged.rollback();
            Problem::new(
                ProblemCode::StaleRevision,
                format!(
                    "{subject} was replaced on disk after this request was checked; the \
                     replacement has been left untouched. Reload it and retry"
                ),
            )
        }
        // The entry is in staging and could not be given back. It is *not*
        // discarded: the manifest describes where it belongs, and recovery will
        // try again at the next start.
        crate::staging::TakeError::Orphaned(cause) => Problem::new(
            ProblemCode::PartialFailure,
            format!(
                "{subject} was moved out of the vault and could not be put back ({}); it is held \
                  in the vault's `.bbb/staging` directory. Recovery will try again at the next \
                  start; if the destination is occupied, use `bbb doctor` and see \
                  `.bbb/staging/recovery.txt`",
                cause.kind()
            ),
        ),
        crate::staging::TakeError::Io(cause) => {
            rollback(staged, &format!("{subject} could not be removed"), &cause)
        }
    }
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
    // The order file is part of what the API exposes, so it is part of what
    // "the vault changed" means. Hashing the revision catches an external edit
    // to the file itself, and hashing the children in order below catches the
    // reordering that edit produced — including one that only moved entries
    // around, which every other field would report as identical.
    folder
        .state_revision()
        .map(|revision| *revision.as_bytes())
        .hash(hasher);
    folder.state_access().as_str().hash(hasher);
    hash_diagnostics(folder.diagnostics(), hasher);

    for child in folder.children() {
        match child {
            bbb_vault_core::ChildNode::Folder(folder) => hash_folder(folder, hasher),
            bbb_vault_core::ChildNode::Bookmark(bookmark) => {
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
