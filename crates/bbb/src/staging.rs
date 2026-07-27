//! One reversible change, and recovery from an interrupted one.
//!
//! A multi-file operation that deletes as it goes cannot be undone: once the
//! third file is gone, a failure on the fourth leaves a vault the daemon can
//! neither complete nor restore. So nothing is deleted in place. Entries are
//! *renamed* into `<vault>/.bbb/staging/<id>/`, one atomic operation per entry
//! on the same filesystem, and only once every entry has moved are they
//! destroyed.
//!
//! # Child order files are part of the same transaction
//!
//! A change to what a folder holds is also a change to the order it holds it
//! in, and a cross-parent move is two of those at once. Bolting a best-effort
//! `.bbb-state.json` write onto the side of this protocol would reintroduce
//! exactly the failure mode it exists to prevent: a crash between the two
//! leaving a vault nothing can finish or undo.
//!
//! So a state write is recorded here too. Before the new bytes are written the
//! previous ones are copied into the operation directory and named in the
//! manifest, so a rollback — in this process or in a later one — puts the old
//! order back, and a folder that had no state file at all has it removed again.
//! [`Staged::write_state`] is the only way the daemon writes one.
//!
//! # The manifest is the protocol
//!
//! A rename that no record describes is a file nobody can find again. So before
//! anything moves, the operation writes and syncs a manifest naming every
//! entry, where it came from, and what it will be called while staged. The
//! manifest is extended and re-synced *before each rename*, never after: a
//! crash between the record and the rename leaves a record of something that
//! did not happen, which recovery handles trivially, whereas a crash between
//! the rename and the record would leave a file with no way home.
//!
//! The manifest carries a phase, and the transition between the two is the
//! operation's point of no return:
//!
//! * `staging` — entries are being moved out. The delete has not logically
//!   happened, so an interrupted operation is **rolled back**.
//! * `committed` — every entry has moved and the caller has been told the
//!   delete succeeded. An interrupted operation is **completed**.
//!
//! # Recovery never purges
//!
//! Startup reads every manifest and does what its phase says. Anything that
//! cannot be restored or destroyed is **kept**, listed in
//! `.bbb/staging/recovery.txt`, and reported through `GET /api/v1/health` and
//! `bbb doctor`. An earlier version removed the staging directory at startup,
//! which threw away precisely the files a crash had put there for safekeeping.
//!
//! # The manifest is hostile input
//!
//! It is a file in the user's vault. It can be hand-edited, corrupted, or
//! written by malware, and after a crash it is the only thing telling recovery
//! where to put a file back. So every field is validated before it is used:
//! each origin component, each name and each staged name must be one plain,
//! portable path component, and an origin is resolved handle-by-handle beneath
//! the vault root rather than joined into a path. A manifest that fails any of
//! that is **not acted on at all** — its directory is left exactly as found and
//! reported, because a record that cannot be trusted is not a licence to move
//! or delete anything.
//!
//! Recovery runs while the vault lock is held, so anything it finds is provably
//! the residue of a run that is no longer alive.

use std::io;

use cap_fs_ext::DirExt as _;
use cap_std::fs::Dir;
use serde::{Deserialize, Serialize};

use bbb_vault_core::STATE_FILE_NAME;

use crate::fsx::{self, component};

/// The staging directory's name inside the daemon's state directory.
pub(crate) const STAGING_DIRECTORY: &str = "staging";
/// The manifest's name inside one operation's directory.
const MANIFEST_NAME: &str = "manifest.json";
/// Where retained entries are explained, in the staging root.
const RECOVERY_NAME: &str = "recovery.txt";
/// The manifest format this build writes.
const MANIFEST_VERSION: u32 = 3;

/// The manifest formats this build can still recover from.
///
/// Version 2 is what the previous release wrote. It has no `states` list, which
/// deserialises to an empty one, and everything else about it is unchanged — so
/// a vault upgraded mid-delete is still finished or undone correctly rather
/// than having its residue declared unreadable and left to a human.
const RECOVERABLE_VERSIONS: &[u32] = &[2, MANIFEST_VERSION];

/// How far an operation has got.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    /// Entries are being moved out; an interruption is rolled back.
    Staging,
    /// Every entry has moved; an interruption is completed.
    Committed,
}

/// What kind of thing was staged, which decides how it moves back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Kind {
    /// A regular file.
    File,
    /// A directory, moved whole.
    Directory,
}

/// One entry recorded in a manifest.
///
/// `origin` is a component *vector*, not a path: there is no string for a
/// separator to hide in, and recovery walks it one handle at a time.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    /// The vault-relative directory it came from; empty means the root.
    origin: Vec<String>,
    /// The name it had there.
    name: String,
    /// The name it has while staged.
    staged: String,
    /// Whether it is a file or a directory.
    kind: Kind,
}

/// One folder's child order file, as this operation found it.
///
/// The `origin` is a component vector for the same reason [`Entry`]'s is: there
/// is no string for a separator to hide in, and it is walked one handle at a
/// time. The name inside the folder is always `.bbb-state.json`, so it is not
/// recorded and cannot be redirected by a hand-edited manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct StateRecord {
    /// The vault-relative directory whose order file this is; empty is the root.
    origin: Vec<String>,
    /// The name, inside the operation directory, holding the bytes that were
    /// there before. Absent when the folder had no order file at all, in which
    /// case undoing means removing the one this operation created.
    #[serde(default)]
    backup: Option<String>,
    /// Whether the new bytes actually reached the folder.
    ///
    /// Written `false` first, exactly like an [`Entry`] is recorded before it
    /// moves: a record of something that did not happen is trivial to undo,
    /// whereas a write with no record could not be undone at all.
    applied: bool,
}

impl StateRecord {
    /// Checks every field a filesystem operation would be driven from.
    fn validate(&self) -> Result<(), String> {
        component::check_all(&self.origin).map_err(|(part, error)| {
            format!("its order file's origin component `{part}` is unusable: {error}")
        })?;
        if let Some(backup) = &self.backup {
            component::check(backup)
                .map_err(|error| format!("its backup name `{backup}` is unusable: {error}"))?;
        }
        Ok(())
    }

    /// The origin as a display string, for a message a person reads.
    fn origin_display(&self) -> String {
        if self.origin.is_empty() {
            "the vault root".to_owned()
        } else {
            self.origin.join("/")
        }
    }
}

impl Entry {
    /// Checks every field that will be used to resolve a filesystem name.
    fn validate(&self) -> Result<(), String> {
        component::check_all(&self.origin).map_err(|(part, error)| {
            format!("its origin component `{part}` is unusable: {error}")
        })?;
        component::check(&self.name)
            .map_err(|error| format!("its entry name `{}` is unusable: {error}", self.name))?;
        component::check(&self.staged)
            .map_err(|error| format!("its staged name `{}` is unusable: {error}", self.staged))?;
        Ok(())
    }

    /// The origin as a display string, for a message a person reads.
    fn origin_display(&self) -> String {
        if self.origin.is_empty() {
            "the vault root".to_owned()
        } else {
            self.origin.join("/")
        }
    }
}

/// The durable record of one staged operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    /// The format version, so a future build refuses what it cannot read.
    version: u32,
    /// What the operation was, for the recovery report.
    operation: String,
    /// How far it got.
    phase: Phase,
    /// Set once recovery has tried and failed to resolve this operation.
    ///
    /// It is what lets `bbb doctor` tell a stuck operation from one a running
    /// daemon is in the middle of, without either guessing or racing it.
    #[serde(default)]
    retained: bool,
    /// Every entry it moved, or was about to move.
    entries: Vec<Entry>,
    /// Every child order file it rewrote, or was about to rewrite.
    ///
    /// Absent in a version 2 manifest, which predates ordering entirely.
    #[serde(default)]
    states: Vec<StateRecord>,
}

impl Manifest {
    /// Checks every field a filesystem operation would be driven from.
    fn validate(&self) -> Result<(), String> {
        if !RECOVERABLE_VERSIONS.contains(&self.version) {
            return Err(format!(
                "its manifest is version {}, which this build does not understand",
                self.version
            ));
        }
        if self.operation.is_empty() || self.operation.len() > 64 {
            return Err("its recorded operation name is not usable".to_owned());
        }
        if self
            .operation
            .chars()
            .any(|character| character.is_control() || character == '/' || character == '\\')
        {
            return Err("its recorded operation name is not usable".to_owned());
        }
        for entry in &self.entries {
            entry.validate()?;
        }
        for state in &self.states {
            state.validate()?;
        }
        Ok(())
    }

    /// Whether this operation has anything left that needs undoing or removing.
    fn is_empty(&self) -> bool {
        self.entries.is_empty() && self.states.is_empty()
    }
}

/// A callback armed at a point, used to make a race happen deterministically.
#[cfg(test)]
type Interposition = (FaultPoint, Box<dyn Fn()>);

/// A point at which a test may simulate the process dying.
///
/// The staging types deliberately have no `Drop`, so unwinding out of one of
/// these leaves exactly the bytes on disk that a killed process would.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FaultPoint {
    /// After the manifest exists, before anything has moved.
    BeforeFirstRename,
    /// After at least one entry has moved, with more to go.
    BetweenRenames,
    /// After every entry has moved, before the phase becomes `committed`.
    BeforePhaseFlip,
    /// Immediately after the phase becomes `committed`.
    AfterPhaseFlip,
    /// Part-way through destroying the staged entries.
    MidDestroy,
    /// After an entry is recorded, immediately before it is claimed.
    ///
    /// A test interposes here to replace the entry, which is the race the
    /// verified claim exists to survive.
    BeforeClaim,
    /// After a child order file is recorded, before its new bytes are written.
    BeforeStateWrite,
    /// Immediately after a child order file's new bytes have landed.
    ///
    /// A cross-parent move reaches this twice, once per folder, which is the
    /// half-applied state recovery has to undo.
    AfterStateWrite,
}

#[cfg(test)]
thread_local! {
    static FAULT: std::cell::Cell<Option<FaultPoint>> = const { std::cell::Cell::new(None) };
    /// A callback run at a point, used to make a race happen deterministically.
    static INTERPOSED: std::cell::RefCell<Option<Interposition>> =
        const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
fn trip(point: FaultPoint) {
    let armed = FAULT.with(std::cell::Cell::get);
    assert!(armed != Some(point), "simulated crash at {point:?}");

    // Run at most once, so a callback that itself reaches this point does not
    // recurse. Taken out of the cell before being called for the same reason.
    let action = INTERPOSED.with(|slot| {
        let mut slot = slot.borrow_mut();
        match slot.as_ref() {
            Some((armed, _)) if *armed == point => slot.take().map(|(_, action)| action),
            _ => None,
        }
    });
    if let Some(action) = action {
        action();
    }
}

#[cfg(not(test))]
const fn trip(_point: FaultPoint) {}

/// Why an entry could not be taken into staging.
#[derive(Debug)]
pub(crate) enum TakeError {
    /// The entry was replaced after the caller verified it, and is untouched.
    NotTheSameEntry,
    /// The claim landed and could not be undone; the entry is in staging.
    Orphaned(io::Error),
    /// An ordinary I/O failure.
    Io(io::Error),
}

/// One in-flight change: entries moved out of the vault, and child order files
/// rewritten, under a single durable record.
#[derive(Debug)]
pub(crate) struct Staged {
    /// The `.bbb/staging/<id>` handle everything is renamed into.
    directory: Dir,
    /// The staging root, so the operation's directory can be removed.
    root: Dir,
    /// The vault root, used to resolve an entry's origin when restoring.
    vault: Dir,
    /// This operation's directory name inside the staging root.
    name: String,
    /// The durable record, kept in step with the disk.
    manifest: Manifest,
}

impl Staged {
    /// Opens a fresh staging area and writes its manifest.
    ///
    /// # Errors
    ///
    /// Returns any I/O error from creating the directories or the manifest.
    pub(crate) fn open(state: &Dir, vault: &Dir, operation: &str, id: &str) -> io::Result<Self> {
        let root = fsx::open_or_create_dir(state, STAGING_DIRECTORY)?;
        let name = unique_operation_name(&root, id)?;
        let directory = root.open_dir_nofollow(&name)?;

        let manifest = Manifest {
            version: MANIFEST_VERSION,
            operation: operation.to_owned(),
            phase: Phase::Staging,
            retained: false,
            entries: Vec::new(),
            states: Vec::new(),
        };
        write_manifest(&directory, &manifest)?;

        Ok(Self {
            directory,
            root,
            vault: vault.try_clone()?,
            name,
            manifest,
        })
    }

    /// Moves `name` out of `origin` and into staging.
    ///
    /// `origin_relative` is the origin's vault-relative path, which is what
    /// recovery uses to find it again in a later process.
    ///
    /// # Errors
    ///
    /// Returns any I/O error. The caller should [`Staged::rollback`]; entries
    /// already staged remain restorable.
    pub(crate) fn take(
        &mut self,
        origin: &Dir,
        origin_components: &[String],
        name: &str,
        is_directory: bool,
        expected: fsx::FileIdentity,
    ) -> Result<(), TakeError> {
        component::check_all(origin_components)
            .map_err(|(part, error)| TakeError::Io(invalid(&part, &error.to_string())))?;
        component::check(name).map_err(|error| TakeError::Io(invalid(name, &error.to_string())))?;

        // Staged names are positional, so two entries with the same name from
        // different directories cannot collide with each other.
        let staged = format!("{}-{}", self.manifest.entries.len(), sanitize(name));
        self.manifest.entries.push(Entry {
            origin: origin_components.to_vec(),
            name: name.to_owned(),
            staged: staged.clone(),
            kind: if is_directory {
                Kind::Directory
            } else {
                Kind::File
            },
        });
        // Recorded before the move, so a crash can never orphan the entry.
        write_manifest(&self.directory, &self.manifest).map_err(TakeError::Io)?;

        if self.manifest.entries.len() == 1 {
            trip(FaultPoint::BeforeFirstRename);
        } else {
            trip(FaultPoint::BetweenRenames);
        }
        trip(FaultPoint::BeforeClaim);

        // The claim is bound to the identity the caller verified. If the entry
        // was replaced in between, the replacement is put straight back and the
        // caller is told; nothing of theirs is carried into staging.
        let claimed = fsx::claim_verified(
            origin,
            name,
            &self.directory,
            &staged,
            is_directory,
            expected,
        );

        match claimed {
            Ok(()) => Ok(()),
            Err(error) => {
                // The record describes a move that did not happen. Recovery
                // copes with that, but the manifest should not keep claiming it
                // unless the entry really is sitting in staging.
                let orphaned = matches!(error, fsx::ClaimError::UndoFailed { .. });
                if !orphaned {
                    self.manifest.entries.pop();
                    let _ = write_manifest(&self.directory, &self.manifest);
                }
                Err(match error {
                    fsx::ClaimError::NotTheSameEntry => TakeError::NotTheSameEntry,
                    fsx::ClaimError::Io(error) => TakeError::Io(error),
                    fsx::ClaimError::UndoFailed { cause, .. } => TakeError::Orphaned(cause),
                })
            }
        }
    }

    /// Writes one folder's child order file as part of this change.
    ///
    /// `folder` must be the folder's own directory handle, and `current` the
    /// state file as it was read from it — which is what binds the write to the
    /// exact file whose revision the caller checked. Pass `None` when the
    /// folder has no order file yet; one is then created, and undoing means
    /// removing it again.
    ///
    /// The previous bytes are copied into this operation's directory and named
    /// in the manifest *before* anything is written, so an interrupted run has
    /// a record of both what changed and what it used to be.
    ///
    /// # Errors
    ///
    /// Returns any I/O error, having left the folder's order file exactly as it
    /// was. The caller should [`Staged::rollback`].
    pub(crate) fn write_state(
        &mut self,
        folder: &Dir,
        folder_components: &[String],
        bytes: &[u8],
        current: Option<&fsx::Validated>,
    ) -> io::Result<()> {
        component::check_all(folder_components)
            .map_err(|(part, error)| invalid(&part, &error.to_string()))?;

        // Positional, like a staged entry's name, so two folders in one change
        // cannot collide.
        let backup = match current {
            Some(current) => {
                let name = format!("state-{}.json", self.manifest.states.len());
                fsx::create_new(&self.directory, &name, &current.bytes)?;
                Some(name)
            }
            None => None,
        };

        self.manifest.states.push(StateRecord {
            origin: folder_components.to_vec(),
            backup,
            applied: false,
        });
        write_manifest(&self.directory, &self.manifest)?;
        trip(FaultPoint::BeforeStateWrite);

        let written = match current {
            Some(current) => fsx::replace_validated(folder, STATE_FILE_NAME, bytes, current)
                .map_err(|error| match error {
                    fsx::CommitError::Io(error)
                    | fsx::CommitError::UndoFailed { cause: error, .. } => error,
                    fsx::CommitError::Stale => io::Error::new(
                        io::ErrorKind::AlreadyExists,
                        "the child order file changed while it was being written",
                    ),
                }),
            None => fsx::create_new(folder, STATE_FILE_NAME, bytes),
        };

        if let Err(error) = written {
            // The record describes a write that did not happen; dropping it is
            // safe precisely because nothing landed.
            if let Some(record) = self.manifest.states.pop()
                && let Some(backup) = record.backup
            {
                let _ = fsx::remove_file(&self.directory, &backup);
            }
            let _ = write_manifest(&self.directory, &self.manifest);
            return Err(error);
        }

        if let Some(record) = self.manifest.states.last_mut() {
            record.applied = true;
        }
        write_manifest(&self.directory, &self.manifest)?;
        trip(FaultPoint::AfterStateWrite);
        Ok(())
    }

    /// Commits the deletion: flips the phase, then destroys the entries.
    ///
    /// The phase flip is the point of no return. After it, an interrupted run
    /// is completed rather than undone, because the caller has been told the
    /// delete succeeded.
    ///
    /// # Errors
    ///
    /// Returns an I/O error only from the phase flip, which happens before
    /// anything is destroyed. A later failure to destroy leaves entries for
    /// recovery to finish, and is not reported as a failed delete, because the
    /// vault no longer references them.
    pub(crate) fn commit(mut self) -> io::Result<()> {
        trip(FaultPoint::BeforePhaseFlip);
        self.manifest.phase = Phase::Committed;
        write_manifest(&self.directory, &self.manifest)?;
        trip(FaultPoint::AfterPhaseFlip);

        destroy(&self.directory, &self.manifest);
        drop(self.directory);
        let _ = self.root.remove_dir_all(&self.name);
        Ok(())
    }

    /// Puts every child order file and every staged entry back.
    ///
    /// Undoing runs newest-first, so the order files go back before the entries
    /// they describe and a directory staged before its former contents is put
    /// back before them.
    ///
    /// # Errors
    ///
    /// Returns the first failure, having attempted everything. Anything that
    /// could not be undone stays in staging with its manifest intact, so
    /// recovery and `bbb doctor` can still describe it.
    pub(crate) fn rollback(mut self) -> io::Result<()> {
        let outcome = undo_all(&self.directory, &self.vault, &mut self.manifest);
        let _ = write_manifest(&self.directory, &self.manifest);

        if self.manifest.is_empty() {
            drop(self.directory);
            let _ = self.root.remove_dir_all(&self.name);
        }
        outcome
    }
}

/// An operation whose entries could not be recovered automatically.
#[derive(Debug, Clone)]
pub(crate) struct Retained {
    /// The staging directory holding them, relative to the vault.
    pub(crate) directory: String,
    /// What the interrupted operation was.
    pub(crate) operation: String,
    /// A line per entry, naming where it belongs.
    pub(crate) entries: Vec<String>,
    /// Why it could not be handled.
    pub(crate) reason: String,
}

impl Retained {
    /// A single sentence for a diagnostic or a log line.
    pub(crate) fn summary(&self) -> String {
        format!(
            "{} {} from an interrupted {} could not be recovered ({}); they are kept in {} — see \
             .bbb/{STAGING_DIRECTORY}/{RECOVERY_NAME}",
            self.entries.len(),
            if self.entries.len() == 1 {
                "entry"
            } else {
                "entries"
            },
            self.operation,
            self.reason,
            self.directory,
        )
    }
}

/// Every staged operation that needs a person, with the reason.
///
/// Read-only, and the single definition of "this needs attention", so `doctor`
/// cannot disagree with recovery about what counts. Two things qualify:
///
/// * an operation recovery marked `retained`, meaning it tried and could not
///   resolve it, and
/// * an operation whose manifest is missing, unparseable, or fails validation —
///   a record the daemon will never act on, so it will never clear itself.
///
/// A valid manifest without the flag belongs to an operation a daemon is in the
/// middle of, and is deliberately not reported.
pub(crate) fn needs_attention(state: &Dir) -> Vec<(String, String)> {
    let Ok(root) = fsx::open_dir(state, STAGING_DIRECTORY) else {
        return Vec::new();
    };
    let Ok(entries) = root.entries() else {
        return Vec::new();
    };

    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .collect();
    names.sort();

    let mut report = Vec::new();
    for name in names {
        let Ok(directory) = fsx::open_dir(&root, &name) else {
            report.push((
                staged_path(&name),
                "entries from an interrupted change are held here and the directory cannot be \
                 opened"
                    .to_owned(),
            ));
            continue;
        };
        match read_manifest(&directory) {
            Ok(manifest) if manifest.retained => report.push((
                staged_path(&name),
                format!(
                    "entries from an interrupted {} could not be restored automatically; see \
                     .bbb/{STAGING_DIRECTORY}/{RECOVERY_NAME}",
                    manifest.operation
                ),
            )),
            // A live operation: a daemon is mid-delete and will clear this up.
            Ok(_) => {}
            Err(reason) => report.push((
                staged_path(&name),
                format!(
                    "entries from an interrupted change are held here and {reason}, so the daemon \
                     will not act on them; see .bbb/{STAGING_DIRECTORY}/{RECOVERY_NAME}"
                ),
            )),
        }
    }
    report
}

/// Takes a stranded temporary into staging so it can be found again.
///
/// Called when a commit's undo failed and the temporary holds the user's
/// evicted file. It is moved under a manifest that says where it belongs, so
/// recovery restores it at the next start; if even the move fails the file is
/// left exactly where it is, because losing it is the one outcome that must not
/// happen.
///
/// Returns a sentence describing where the bytes now are, for the caller's
/// error message.
pub(crate) fn rescue(
    state: &Dir,
    vault: &Dir,
    origin: &Dir,
    origin_components: &[String],
    name: &str,
    temporary: &str,
) -> String {
    let mut staged = match Staged::open(state, vault, "rescued_contents", "rescue") {
        Ok(staged) => staged,
        Err(error) => {
            return format!(
                "they remain in `{temporary}`, beside the entry, because a staging area could                  not be opened ({})",
                error.kind()
            );
        }
    };

    // The temporary is ours, created by this process moments ago, so there is
    // no identity to verify against an earlier observation; what matters is
    // that it is recorded before it moves.
    let identity = fsx::read_with_identity(origin, temporary)
        .map_or(fsx::FileIdentity::Unavailable, |validated| {
            validated.identity
        });

    match staged.take(origin, origin_components, temporary, false, identity) {
        Ok(()) => {
            // Rewrite the entry so recovery puts it back under its real name
            // rather than the temporary one.
            if let Some(entry) = staged.manifest.entries.last_mut() {
                name.clone_into(&mut entry.name);
            }
            let _ = write_manifest(&staged.directory, &staged.manifest);
            let directory = staged_path(&staged.name);
            format!(
                "they are held in `{directory}`; recovery will try again at the next start, and \
                 will retain them there if the destination is occupied"
            )
        }
        Err(_) => format!(
            "they remain in `{temporary}`, beside the entry; move it back over `{name}` yourself"
        ),
    }
}

/// Finishes or undoes every operation a previous run left behind.
///
/// Called once at startup with the vault lock held. Nothing is removed without
/// its own manifest saying so.
pub(crate) fn recover(state: &Dir, vault: &Dir) -> Vec<Retained> {
    let Ok(root) = fsx::open_or_create_dir(state, STAGING_DIRECTORY) else {
        return Vec::new();
    };

    let mut retained = Vec::new();
    let Ok(entries) = root.entries() else {
        return retained;
    };

    let mut names: Vec<String> = entries
        .flatten()
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        .collect();
    // Deterministic order, so two runs over the same residue report the same.
    names.sort();

    for name in names {
        if let Some(problem) = recover_one(&root, vault, &name) {
            retained.push(problem);
        }
    }

    write_recovery_report(&root, &retained);
    retained
}

fn recover_one(root: &Dir, vault: &Dir, name: &str) -> Option<Retained> {
    let directory = match root.open_dir_nofollow(name) {
        Ok(directory) => directory,
        Err(error) => {
            return Some(Retained {
                directory: staged_path(name),
                operation: "change of unknown kind".to_owned(),
                entries: vec![name.to_owned()],
                reason: format!("its directory could not be opened: {}", error.kind()),
            });
        }
    };

    let mut manifest = match read_manifest(&directory) {
        Ok(manifest) => manifest,
        Err(reason) => {
            // No usable record of where these belong. They are kept exactly as
            // found: guessing is how a crash turns into data loss.
            return Some(Retained {
                directory: staged_path(name),
                operation: "change of unknown kind".to_owned(),
                entries: staged_entry_names(&directory),
                reason,
            });
        }
    };

    match manifest.phase {
        Phase::Staging => {
            let outcome = undo_all(&directory, vault, &mut manifest);
            let _ = write_manifest(&directory, &manifest);
            if manifest.is_empty() {
                drop(directory);
                let _ = root.remove_dir_all(name);
                tracing::info!(
                    operation = %manifest.operation,
                    "rolled back a change interrupted before it committed"
                );
                return None;
            }
            manifest.retained = true;
            let _ = write_manifest(&directory, &manifest);
            Some(Retained {
                directory: staged_path(name),
                operation: manifest.operation.clone(),
                entries: manifest
                    .entries
                    .iter()
                    .map(describe)
                    .chain(manifest.states.iter().map(describe_state))
                    .collect(),
                reason: outcome.err().map_or_else(
                    || "they could not be restored".to_owned(),
                    |error| error.kind().to_string(),
                ),
            })
        }
        Phase::Committed => {
            destroy(&directory, &manifest);
            let leftovers = staged_entry_names(&directory);
            if !leftovers.is_empty() {
                manifest.retained = true;
                let _ = write_manifest(&directory, &manifest);
            }
            if leftovers.is_empty() {
                drop(directory);
                let _ = root.remove_dir_all(name);
                tracing::info!(
                    operation = %manifest.operation,
                    "completed a change interrupted after it committed"
                );
                return None;
            }
            Some(Retained {
                directory: staged_path(name),
                operation: manifest.operation,
                entries: leftovers,
                reason: "they could not be removed".to_owned(),
            })
        }
    }
}

/// Undoes everything the operation did, dropping from `manifest` what succeeds.
///
/// The order files go first, because an entry's membership record must not
/// outlive the entry itself: putting a bookmark back into a folder whose order
/// file has already been reverted is fine, while the reverse would leave the
/// order naming something that is not there yet.
///
/// An entry whose staged file is absent was recorded but never moved — the
/// manifest is written first on purpose — and counts as restored. A state
/// record that was never applied is the same case.
fn undo_all(directory: &Dir, vault: &Dir, manifest: &mut Manifest) -> io::Result<()> {
    let mut failure = None;

    let mut kept_states = Vec::new();
    for state in manifest.states.iter().rev() {
        if let Err(error) = undo_state(directory, vault, state) {
            failure.get_or_insert(error);
            kept_states.push(state.clone());
        }
    }
    kept_states.reverse();
    manifest.states = kept_states;

    let mut kept = Vec::new();
    for entry in manifest.entries.iter().rev() {
        if let Err(error) = restore_one(directory, vault, entry) {
            failure.get_or_insert(error);
            kept.push(entry.clone());
        }
    }
    kept.reverse();
    manifest.entries = kept;

    match failure {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// Puts one folder's child order file back the way this operation found it.
fn undo_state(directory: &Dir, vault: &Dir, state: &StateRecord) -> io::Result<()> {
    // Validated at the point of use: this is reachable from recovery, whose
    // manifest came off disk, and from rollback, whose did not.
    state
        .validate()
        .map_err(|reason| io::Error::new(io::ErrorKind::InvalidInput, reason))?;

    if !state.applied {
        // Recorded but never written; there is nothing to put back.
        return Ok(());
    }

    let folder = fsx::open_components(vault, &state.origin)?;
    match &state.backup {
        Some(backup) => {
            let bytes = fsx::read(directory, backup)?;
            fsx::write_replacing(&folder, STATE_FILE_NAME, &bytes)
        }
        // The folder had no order file, so this operation created it and undoing
        // means it should have none again. An order file that is already gone is
        // the outcome that was wanted.
        None => match fsx::remove_file(&folder, STATE_FILE_NAME) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
            other => other,
        },
    }
}

fn restore_one(directory: &Dir, vault: &Dir, entry: &Entry) -> io::Result<()> {
    // Validated again at the point of use: this function is reachable from
    // recovery, whose manifest came off disk, and from rollback, whose did not.
    entry
        .validate()
        .map_err(|reason| io::Error::new(io::ErrorKind::InvalidInput, reason))?;

    if !fsx::exists(directory, &entry.staged) {
        // Recorded but never moved; there is nothing to put back.
        return Ok(());
    }
    // Walked one handle at a time beneath the vault root — never joined into a
    // path and opened, which is what would let a crafted origin escape.
    let origin = fsx::open_components(vault, &entry.origin)?;
    match entry.kind {
        Kind::Directory => fsx::move_dir(directory, &entry.staged, &origin, &entry.name),
        Kind::File => fsx::move_file(directory, &entry.staged, &origin, &entry.name),
    }
}

/// Removes every staged entry the manifest names, and every order-file backup.
///
/// A backup only ever holds bytes the daemon itself wrote a moment earlier, and
/// once the change has committed it is the superseded copy — so unlike a staged
/// entry it is never something a person needs back.
fn destroy(directory: &Dir, manifest: &Manifest) {
    for state in &manifest.states {
        if let Some(backup) = &state.backup
            && component::check(backup).is_ok()
        {
            let _ = fsx::remove_file(directory, backup);
        }
    }
    for (index, entry) in manifest.entries.iter().enumerate() {
        if index > 0 {
            trip(FaultPoint::MidDestroy);
        }
        if entry.validate().is_err() {
            // Unreachable for a manifest that came through `read_manifest`;
            // refusing here as well means no future caller can bypass it.
            continue;
        }
        let removed = match entry.kind {
            Kind::Directory => fsx::remove_dir_all(directory, &entry.staged),
            Kind::File => fsx::remove_file(directory, &entry.staged),
        };
        if let Err(error) = removed
            && error.kind() != io::ErrorKind::NotFound
        {
            tracing::warn!(
                error = %error.kind(),
                "a staged entry could not be destroyed; it is kept for the next recovery"
            );
        }
    }
}

/// Writes the manifest durably, replacing any previous version.
fn write_manifest(directory: &Dir, manifest: &Manifest) -> io::Result<()> {
    let bytes = serde_json::to_vec_pretty(manifest)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;

    // The manifest is all that stands between a crash and an orphaned file, so
    // it is written the same way vault content is: a fresh temporary, synced,
    // renamed into place, and the directory synced behind it.
    if directory.symlink_metadata(MANIFEST_NAME).is_ok() {
        let validated = fsx::read_with_identity(directory, MANIFEST_NAME)?;
        fsx::replace_validated(directory, MANIFEST_NAME, &bytes, &validated).map_err(|error| {
            match error {
                fsx::CommitError::Io(error) => error,
                fsx::CommitError::Stale | fsx::CommitError::UndoFailed { .. } => io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "the staging manifest changed underneath the daemon",
                ),
            }
        })
    } else {
        fsx::create_new(directory, MANIFEST_NAME, &bytes)
    }
}

fn read_manifest(directory: &Dir) -> Result<Manifest, String> {
    let bytes = fsx::read(directory, MANIFEST_NAME)
        .map_err(|error| format!("its manifest could not be read: {}", error.kind()))?;
    let manifest: Manifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("its manifest is not readable: {error}"))?;
    // Every field is checked before a single filesystem name is built from it.
    // A manifest that fails here is never acted on: see `recover_one`.
    manifest.validate()?;
    Ok(manifest)
}

/// Writes, or clears, the human-facing explanation in the staging root.
fn write_recovery_report(root: &Dir, retained: &[Retained]) {
    let _ = fsx::remove_file(root, RECOVERY_NAME);
    if retained.is_empty() {
        return;
    }

    let mut report = String::from(
        "Some entries from an interrupted change could not be recovered automatically.\n\
         They are kept exactly as they were found; nothing here has been deleted.\n\
         Each line gives a staged entry and where it belongs in the vault.\n\n",
    );
    for item in retained {
        use std::fmt::Write as _;
        let _ = writeln!(
            report,
            "{} ({}): {}",
            item.directory, item.operation, item.reason
        );
        for entry in &item.entries {
            report.push_str("    ");
            report.push_str(entry);
            report.push('\n');
        }
        report.push('\n');
    }

    if let Err(error) = fsx::create_new(root, RECOVERY_NAME, report.as_bytes()) {
        tracing::warn!(error = %error.kind(), "the recovery report could not be written");
    }
}

fn describe(entry: &Entry) -> String {
    format!(
        "{} belongs in {} as {}",
        entry.staged,
        entry.origin_display(),
        entry.name
    )
}

fn describe_state(state: &StateRecord) -> String {
    match &state.backup {
        Some(backup) => format!(
            "{backup} is the child order {} had before this change",
            state.origin_display()
        ),
        None => format!(
            "{} was given a child order file this change meant to remove again",
            state.origin_display()
        ),
    }
}

fn staged_entry_names(directory: &Dir) -> Vec<String> {
    let Ok(entries) = directory.entries() else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name != MANIFEST_NAME)
        .collect();
    names.sort();
    names
}

fn staged_path(name: &str) -> String {
    format!(".bbb/{STAGING_DIRECTORY}/{name}")
}

/// Claims a directory name for one operation.
///
/// `create_dir` is the claim, so two operations cannot take the same name even
/// when they share an identity, which happens when a delete is retried.
fn unique_operation_name(root: &Dir, id: &str) -> io::Result<String> {
    let base = sanitize(id);
    for attempt in 0..64 {
        let candidate = format!("{base}-{attempt}");
        match root.create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "no staging directory name was free",
    ))
}

/// Makes a name safe to use as a single staged component.
fn invalid(name: &str, reason: &str) -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        format!("`{name}` is not a usable name: {reason}"),
    )
}

fn sanitize(name: &str) -> String {
    name.chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.') {
                character
            } else {
                '_'
            }
        })
        .take(64)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dev_components() -> Vec<String> {
        vec!["Dev".to_owned()]
    }

    fn file_identity(dir: &Dir, name: &str) -> fsx::FileIdentity {
        fsx::read_with_identity(dir, name)
            .expect("read for identity")
            .identity
    }

    fn dir_identity(dir: &Dir, name: &str) -> fsx::FileIdentity {
        let handle = fsx::open_dir(dir, name).expect("open for identity");
        fsx::directory_identity(&handle).expect("identity")
    }

    struct Fixture {
        _temp: tempfile::TempDir,
        vault: Dir,
        state: Dir,
    }

    fn fixture() -> Fixture {
        let temp = tempfile::tempdir().expect("temp dir");
        let vault = fsx::open_root(temp.path()).expect("open root");
        let state = fsx::open_or_create_dir(&vault, ".bbb").expect("state dir");
        vault.create_dir("Dev").expect("create Dev");
        let dev = vault.open_dir_nofollow("Dev").expect("open Dev");
        fsx::create_new(&dev, "React--a1.md", b"bookmark").expect("create");
        dev.create_dir("React--a1.assets").expect("create assets");
        let assets = dev.open_dir_nofollow("React--a1.assets").expect("open");
        fsx::create_new(&assets, "logo.png", b"PNG").expect("create logo");
        Fixture {
            _temp: temp,
            vault,
            state,
        }
    }

    impl Fixture {
        fn dev(&self) -> Dir {
            self.vault.open_dir_nofollow("Dev").expect("open Dev")
        }

        fn bookmark_is_present(&self) -> bool {
            self.dev().symlink_metadata("React--a1.md").is_ok()
        }

        fn assets_are_present(&self) -> bool {
            self.dev().symlink_metadata("React--a1.assets").is_ok()
        }

        fn staging_is_clear(&self) -> bool {
            let root =
                fsx::open_or_create_dir(&self.state, STAGING_DIRECTORY).expect("staging root");
            root.entries()
                .expect("entries")
                .flatten()
                .all(|entry| entry.file_name() == RECOVERY_NAME)
        }

        fn stage_both(&self) -> Staged {
            let mut staged =
                Staged::open(&self.state, &self.vault, "delete_bookmark", "a1").expect("staging");
            let origin = self.dev();
            let bookmark = file_identity(&origin, "React--a1.md");
            let assets = dir_identity(&origin, "React--a1.assets");
            staged
                .take(&origin, &dev_components(), "React--a1.md", false, bookmark)
                .expect("stage bookmark");
            staged
                .take(&origin, &dev_components(), "React--a1.assets", true, assets)
                .expect("stage assets");
            staged
        }
    }

    /// Runs `body` with a simulated crash armed at `point`.
    ///
    /// The staging types have no `Drop`, so what is left on disk after the
    /// unwind is what a killed process would have left.
    fn crash_at(point: FaultPoint, body: impl FnOnce()) {
        FAULT.with(|fault| fault.set(Some(point)));
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {}));
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(body));
        std::panic::set_hook(previous);
        FAULT.with(|fault| fault.set(None));
        assert!(outcome.is_err(), "the fault at {point:?} never tripped");
    }

    #[test]
    fn a_rollback_puts_every_entry_back() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        assert!(!fixture.bookmark_is_present());

        staged.rollback().expect("rollback");

        assert!(fixture.bookmark_is_present());
        assert!(fixture.assets_are_present());
        assert_eq!(
            fsx::read(&fixture.dev(), "React--a1.md").expect("read"),
            b"bookmark"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_commit_destroys_everything_staged() {
        let fixture = fixture();
        fixture.stage_both().commit().expect("commit");

        assert!(!fixture.bookmark_is_present());
        assert!(!fixture.assets_are_present());
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_crash_before_the_first_rename_leaves_the_vault_untouched() {
        let fixture = fixture();
        crash_at(FaultPoint::BeforeFirstRename, || {
            let _ = fixture.stage_both();
        });
        assert!(fixture.bookmark_is_present(), "nothing had moved yet");

        assert!(recover(&fixture.state, &fixture.vault).is_empty());
        assert!(fixture.bookmark_is_present());
        assert!(fixture.assets_are_present());
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_crash_between_renames_is_rolled_back() {
        let fixture = fixture();
        crash_at(FaultPoint::BetweenRenames, || {
            let _ = fixture.stage_both();
        });
        assert!(!fixture.bookmark_is_present(), "the first entry had moved");

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert!(fixture.bookmark_is_present(), "and is put back");
        assert!(fixture.assets_are_present());
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_crash_before_the_phase_flip_is_rolled_back() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        crash_at(FaultPoint::BeforePhaseFlip, move || {
            let _ = staged.commit();
        });
        assert!(!fixture.bookmark_is_present(), "both entries had moved");

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert!(
            fixture.bookmark_is_present() && fixture.assets_are_present(),
            "an operation that never committed is undone in full"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_crash_after_the_phase_flip_is_completed() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        crash_at(FaultPoint::AfterPhaseFlip, move || {
            let _ = staged.commit();
        });

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert!(
            !fixture.bookmark_is_present() && !fixture.assets_are_present(),
            "a committed delete is finished, never undone"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_crash_part_way_through_destroying_is_completed() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        crash_at(FaultPoint::MidDestroy, move || {
            let _ = staged.commit();
        });

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert!(!fixture.bookmark_is_present() && !fixture.assets_are_present());
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn an_unreadable_manifest_keeps_everything_and_explains_itself() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        let operation = staged.name.clone();
        // Leaked rather than committed or rolled back, then its record is
        // corrupted: the worst case recovery has to survive.
        core::mem::forget(staged);

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = root.open_dir_nofollow(&operation).expect("op dir");
        fsx::remove_file(&directory, MANIFEST_NAME).expect("remove manifest");
        fsx::create_new(&directory, MANIFEST_NAME, b"{ not json").expect("corrupt");

        let retained = recover(&fixture.state, &fixture.vault);
        assert_eq!(retained.len(), 1, "{retained:?}");
        assert_eq!(retained[0].entries.len(), 2, "both entries are kept");
        assert!(
            retained[0].reason.contains("not readable"),
            "{}",
            retained[0].reason
        );
        assert!(
            directory.symlink_metadata("0-React--a1.md").is_ok(),
            "the staged bookmark is still there"
        );

        let report =
            String::from_utf8(fsx::read(&root, RECOVERY_NAME).expect("report")).expect("utf-8");
        assert!(report.contains("nothing here has been deleted"), "{report}");
        assert!(report.contains(&operation), "{report}");
    }

    #[test]
    fn a_restore_that_cannot_land_keeps_the_entry_and_reports_it() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        let operation = staged.name.clone();
        core::mem::forget(staged);

        // The origin directory is gone, so the entries have nowhere to return.
        fixture.vault.remove_dir_all("Dev").expect("remove origin");

        let retained = recover(&fixture.state, &fixture.vault);
        assert_eq!(retained.len(), 1, "{retained:?}");
        assert_eq!(retained[0].entries.len(), 2);
        let summary = retained[0].summary();
        assert!(summary.contains("could not be recovered"), "{summary}");
        assert!(summary.contains("recovery.txt"), "{summary}");

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = root.open_dir_nofollow(&operation).expect("op dir");
        assert!(
            directory.symlink_metadata("0-React--a1.md").is_ok(),
            "an entry that cannot be restored is kept, never dropped"
        );
    }

    #[test]
    fn recovery_is_idempotent() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        core::mem::forget(staged);
        fixture.vault.remove_dir_all("Dev").expect("remove origin");

        let first = recover(&fixture.state, &fixture.vault);
        let second = recover(&fixture.state, &fixture.vault);
        assert_eq!(first.len(), second.len());
        assert_eq!(first[0].entries.len(), second[0].entries.len());
    }

    #[test]
    fn recovery_of_an_empty_staging_area_reports_nothing() {
        let fixture = fixture();
        assert!(recover(&fixture.state, &fixture.vault).is_empty());
        assert!(fixture.bookmark_is_present());
    }

    /// Runs `body` with `interposed` executed at `point`.
    ///
    /// This is how a race is made to happen on purpose: the callback runs at the
    /// exact instant between recording an entry and claiming it, which is the
    /// window a verified claim has to survive.
    fn interpose_at(point: FaultPoint, interposed: impl Fn() + 'static, body: impl FnOnce()) {
        INTERPOSED.with(|slot| *slot.borrow_mut() = Some((point, Box::new(interposed))));
        body();
        INTERPOSED.with(|slot| *slot.borrow_mut() = None);
    }

    #[test]
    fn a_file_replaced_just_before_the_claim_survives_and_is_refused() {
        let fixture = fixture();
        let origin = fixture.dev();
        let expected = file_identity(&origin, "React--a1.md");

        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");

        // Between the manifest record and the claim, somebody replaces the
        // bookmark with a different file that happens to share its name.
        let vault = fixture.vault.try_clone().expect("clone");
        let outcome = {
            let mut result = None;
            interpose_at(
                FaultPoint::BeforeClaim,
                move || {
                    let dev = fsx::open_dir(&vault, "Dev").expect("open Dev");
                    fsx::remove_file(&dev, "React--a1.md").expect("remove");
                    fsx::create_new(&dev, "React--a1.md", b"THEIRS").expect("replace");
                },
                || {
                    result = Some(staged.take(
                        &origin,
                        &dev_components(),
                        "React--a1.md",
                        false,
                        expected,
                    ));
                },
            );
            result.expect("the body ran")
        };

        assert!(
            matches!(outcome, Err(TakeError::NotTheSameEntry)),
            "{outcome:?}"
        );
        assert_eq!(
            fsx::read(&fixture.dev(), "React--a1.md").expect("read"),
            b"THEIRS",
            "the replacement must be left exactly where it was"
        );
    }

    #[test]
    fn a_directory_replaced_just_before_the_claim_survives_and_is_refused() {
        let fixture = fixture();
        let origin = fixture.dev();
        let expected = dir_identity(&origin, "React--a1.assets");

        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_folder", "a1").expect("staging");

        let vault = fixture.vault.try_clone().expect("clone");
        let outcome = {
            let mut result = None;
            interpose_at(
                FaultPoint::BeforeClaim,
                move || {
                    let dev = fsx::open_dir(&vault, "Dev").expect("open Dev");
                    fsx::remove_dir_all(&dev, "React--a1.assets").expect("remove");
                    fsx::create_dir(&dev, "React--a1.assets").expect("recreate");
                    let replacement =
                        fsx::open_dir(&dev, "React--a1.assets").expect("open replacement");
                    fsx::create_new(&replacement, "theirs.png", b"THEIRS").expect("write");
                },
                || {
                    result = Some(staged.take(
                        &origin,
                        &dev_components(),
                        "React--a1.assets",
                        true,
                        expected,
                    ));
                },
            );
            result.expect("the body ran")
        };

        assert!(
            matches!(outcome, Err(TakeError::NotTheSameEntry)),
            "{outcome:?}"
        );
        let replacement = fsx::open_dir(&fixture.dev(), "React--a1.assets")
            .expect("the replacement directory is still there");
        assert_eq!(
            fsx::read(&replacement, "theirs.png").expect("read"),
            b"THEIRS",
            "the replacement directory's contents must survive"
        );
    }

    #[test]
    fn a_refused_claim_leaves_no_trace_in_the_manifest() {
        let fixture = fixture();
        let origin = fixture.dev();
        let expected = file_identity(&origin, "React--a1.md");
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");

        let vault = fixture.vault.try_clone().expect("clone");
        interpose_at(
            FaultPoint::BeforeClaim,
            move || {
                let dev = fsx::open_dir(&vault, "Dev").expect("open Dev");
                fsx::remove_file(&dev, "React--a1.md").expect("remove");
                fsx::create_new(&dev, "React--a1.md", b"THEIRS").expect("replace");
            },
            || {
                let _ = staged.take(&origin, &dev_components(), "React--a1.md", false, expected);
            },
        );

        assert!(
            staged.manifest.entries.is_empty(),
            "an entry that was never taken must not stay in the record"
        );
        staged.rollback().expect("rollback");
        assert_eq!(
            fsx::read(&fixture.dev(), "React--a1.md").expect("read"),
            b"THEIRS"
        );
    }

    #[test]
    fn an_undo_that_fails_keeps_the_entry_and_recovery_puts_it_back() {
        let fixture = fixture();
        let origin = fixture.dev();
        let expected = file_identity(&origin, "React--a1.md");
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");

        // The entry is replaced, so the claim must be given back — and giving
        // it back fails. The bytes are now in staging and must stay there.
        let vault = fixture.vault.try_clone().expect("clone");
        let mut outcome = None;
        interpose_at(
            FaultPoint::BeforeClaim,
            move || {
                let dev = fsx::open_dir(&vault, "Dev").expect("open Dev");
                fsx::remove_file(&dev, "React--a1.md").expect("remove");
                fsx::create_new(&dev, "React--a1.md", b"THEIRS").expect("replace");
                fsx::fail_next_undo();
            },
            || {
                outcome =
                    Some(staged.take(&origin, &dev_components(), "React--a1.md", false, expected));
            },
        );

        let outcome = outcome.expect("the body ran");
        assert!(
            matches!(outcome, Err(TakeError::Orphaned(_))),
            "{outcome:?}"
        );
        assert!(
            !staged.manifest.entries.is_empty(),
            "an entry stuck in staging must stay in the record, or nothing can find it"
        );
        let operation = staged.name.clone();
        core::mem::forget(staged);

        // It is still there — never deleted — and recovery deals with it.
        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = fsx::open_dir(&root, &operation).expect("op dir");
        assert!(
            fsx::exists(&directory, "0-React--a1.md"),
            "the claimed entry must not be discarded"
        );

        // The failed undo strands the placeholder on the origin name; because
        // it is provably ours it is cleared, which leaves the name free for
        // recovery to put the entry back into. The vault then looks exactly as
        // the other writer left it.
        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert_eq!(
            fsx::read(&fixture.dev(), "React--a1.md").expect("read"),
            b"THEIRS",
            "the entry taken by mistake is returned, byte for byte"
        );
        assert!(
            !fsx::exists(&directory, "0-React--a1.md"),
            "and nothing is left behind in staging once it has been returned"
        );
    }

    #[test]
    fn an_undo_that_fails_onto_an_occupied_name_keeps_the_entry() {
        let fixture = fixture();
        let origin = fixture.dev();
        let expected = file_identity(&origin, "React--a1.md");
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");

        let vault = fixture.vault.try_clone().expect("clone");
        let mut outcome = None;
        interpose_at(
            FaultPoint::BeforeClaim,
            move || {
                let dev = fsx::open_dir(&vault, "Dev").expect("open Dev");
                fsx::remove_file(&dev, "React--a1.md").expect("remove");
                fsx::create_new(&dev, "React--a1.md", b"THEIRS").expect("replace");
                fsx::fail_next_undo();
            },
            || {
                outcome =
                    Some(staged.take(&origin, &dev_components(), "React--a1.md", false, expected));
            },
        );
        assert!(matches!(outcome, Some(Err(TakeError::Orphaned(_)))));
        let operation = staged.name.clone();
        core::mem::forget(staged);

        // Somebody takes the freed name before recovery runs. The entry must
        // then be kept and reported, never forced over what is now there.
        fsx::create_new(&fixture.dev(), "React--a1.md", b"A THIRD FILE").expect("occupy");

        let retained = recover(&fixture.state, &fixture.vault);
        assert_eq!(retained.len(), 1, "{retained:?}");
        assert_eq!(
            fsx::read(&fixture.dev(), "React--a1.md").expect("read"),
            b"A THIRD FILE",
            "recovery must not overwrite whatever now holds the name"
        );

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = fsx::open_dir(&root, &operation).expect("op dir");
        assert!(
            fsx::exists(&directory, "0-React--a1.md"),
            "the entry is kept for the user rather than discarded"
        );
    }

    #[test]
    fn a_hostile_manifest_is_never_acted_on() {
        for (label, body) in [
            (
                "escaping origin",
                r#"{"version":2,"operation":"delete_bookmark","phase":"staging","entries":[
                   {"origin":["..",".."],"name":"passwd","staged":"0-x","kind":"file"}]}"#,
            ),
            (
                "separator in origin",
                r#"{"version":2,"operation":"delete_bookmark","phase":"staging","entries":[
                   {"origin":["../../etc"],"name":"passwd","staged":"0-x","kind":"file"}]}"#,
            ),
            (
                "state directory as origin",
                r#"{"version":2,"operation":"delete_bookmark","phase":"staging","entries":[
                   {"origin":[".bbb"],"name":"lock","staged":"0-x","kind":"file"}]}"#,
            ),
            (
                "traversal in the name",
                r#"{"version":2,"operation":"delete_bookmark","phase":"staging","entries":[
                   {"origin":[],"name":"../escape.md","staged":"0-x","kind":"file"}]}"#,
            ),
            (
                "traversal in the staged name",
                r#"{"version":2,"operation":"delete_bookmark","phase":"committed","entries":[
                   {"origin":[],"name":"x.md","staged":"../../../x.md","kind":"file"}]}"#,
            ),
            (
                "absolute staged name",
                r#"{"version":2,"operation":"delete_bookmark","phase":"committed","entries":[
                   {"origin":[],"name":"x.md","staged":"/etc/passwd","kind":"file"}]}"#,
            ),
            (
                "old version",
                r#"{"version":1,"operation":"delete_bookmark","phase":"staging","entries":[]}"#,
            ),
            ("not json", "{ not json"),
        ] {
            let fixture = fixture();
            let root =
                fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("staging root");
            fsx::create_dir(&root, "op-0").expect("op dir");
            let directory = fsx::open_dir(&root, "op-0").expect("open op");
            fsx::create_new(&directory, MANIFEST_NAME, body.as_bytes()).expect("manifest");
            fsx::create_new(&directory, "0-x", b"staged bytes").expect("staged entry");

            let retained = recover(&fixture.state, &fixture.vault);

            assert_eq!(retained.len(), 1, "{label}: {retained:?}");
            assert!(
                fsx::exists(&directory, "0-x"),
                "{label}: the staged bytes must be left exactly as found"
            );
            assert!(
                fixture.bookmark_is_present(),
                "{label}: nothing in the vault may be touched"
            );
            assert!(
                fixture.vault.symlink_metadata("passwd").is_err()
                    && fixture.vault.symlink_metadata("escape.md").is_err(),
                "{label}: nothing may be created from a hostile record"
            );
        }
    }

    #[test]
    fn a_manifest_naming_a_windows_device_is_refused() {
        let fixture = fixture();
        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        fsx::create_dir(&root, "op-0").expect("op dir");
        let directory = fsx::open_dir(&root, "op-0").expect("open op");
        fsx::create_new(
            &directory,
            MANIFEST_NAME,
            br#"{"version":2,"operation":"delete_bookmark","phase":"staging","entries":[
               {"origin":[],"name":"NUL","staged":"0-x","kind":"file"}]}"#,
        )
        .expect("manifest");

        let retained = recover(&fixture.state, &fixture.vault);
        assert_eq!(retained.len(), 1, "{retained:?}");
        assert!(
            retained[0].reason.contains("Windows device"),
            "{}",
            retained[0].reason
        );
    }

    #[test]
    fn recovery_marks_what_it_could_not_resolve() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        let operation = staged.name.clone();
        core::mem::forget(staged);
        fixture.vault.remove_dir_all("Dev").expect("remove origin");

        assert_eq!(recover(&fixture.state, &fixture.vault).len(), 1);

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = fsx::open_dir(&root, &operation).expect("op dir");
        let manifest = read_manifest(&directory).expect("still readable");
        assert!(
            manifest.retained,
            "recovery must record that it gave up, so doctor can tell this from a live operation"
        );
    }

    #[test]
    fn a_live_operation_is_not_marked_retained() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        let manifest = read_manifest(&staged.directory).expect("readable");
        assert!(
            !manifest.retained,
            "an operation in progress must not look like a stuck one"
        );
        staged.rollback().expect("rollback");
    }

    #[test]
    fn entries_with_the_same_name_do_not_collide_in_staging() {
        let fixture = fixture();
        fixture.vault.create_dir("Other").expect("create Other");
        let other = fixture.vault.open_dir_nofollow("Other").expect("open");
        fsx::create_new(&other, "React--a1.md", b"other").expect("create");

        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");
        let one = file_identity(&fixture.dev(), "React--a1.md");
        let two = file_identity(&other, "React--a1.md");
        staged
            .take(
                &fixture.dev(),
                &dev_components(),
                "React--a1.md",
                false,
                one,
            )
            .expect("stage one");
        staged
            .take(&other, &["Other".to_owned()], "React--a1.md", false, two)
            .expect("stage two");
        staged.rollback().expect("rollback");

        assert_eq!(
            fsx::read(&fixture.dev(), "React--a1.md").expect("read"),
            b"bookmark"
        );
        assert_eq!(fsx::read(&other, "React--a1.md").expect("read"), b"other");
    }

    // -- child order files -------------------------------------------------

    const FIRST: &[u8] = b"{\n  \"version\": 1,\n  \"children\": []\n}\n";
    const SECOND: &[u8] = b"{\n  \"version\": 1,\n  \"children\": [1]\n}\n";

    impl Fixture {
        /// The child order file `Dev` currently has, if any.
        fn dev_order(&self) -> Option<Vec<u8>> {
            fsx::read(&self.dev(), STATE_FILE_NAME).ok()
        }

        /// Gives `Dev` an order file, outside any transaction.
        fn seed_dev_order(&self, bytes: &[u8]) {
            fsx::create_new(&self.dev(), STATE_FILE_NAME, bytes).expect("seed order");
        }

        /// Writes `bytes` as `Dev`'s order inside `staged`.
        fn write_dev_order(&self, staged: &mut Staged, bytes: &[u8]) {
            let dev = self.dev();
            let current = fsx::read_with_identity(&dev, STATE_FILE_NAME).ok();
            staged
                .write_state(&dev, &dev_components(), bytes, current.as_ref())
                .expect("write order");
        }
    }

    #[test]
    fn a_rollback_puts_a_replaced_child_order_back() {
        let fixture = fixture();
        fixture.seed_dev_order(FIRST);

        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "set_order", "dev").expect("staging");
        fixture.write_dev_order(&mut staged, SECOND);
        assert_eq!(fixture.dev_order().as_deref(), Some(SECOND));

        staged.rollback().expect("rollback");
        assert_eq!(
            fixture.dev_order().as_deref(),
            Some(FIRST),
            "the order the change found is the order it leaves behind"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_rollback_removes_a_child_order_the_change_created() {
        let fixture = fixture();
        assert!(fixture.dev_order().is_none());

        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "create", "dev").expect("staging");
        fixture.write_dev_order(&mut staged, FIRST);
        assert!(fixture.dev_order().is_some());

        staged.rollback().expect("rollback");
        assert!(
            fixture.dev_order().is_none(),
            "a folder that had no order file must not be left with one"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_commit_keeps_the_new_child_order_and_clears_the_backup() {
        let fixture = fixture();
        fixture.seed_dev_order(FIRST);

        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "set_order", "dev").expect("staging");
        fixture.write_dev_order(&mut staged, SECOND);
        staged.commit().expect("commit");

        assert_eq!(fixture.dev_order().as_deref(), Some(SECOND));
        assert!(
            fixture.staging_is_clear(),
            "the backup goes with the commit"
        );
    }

    #[test]
    fn a_crash_before_a_child_order_is_written_leaves_it_alone() {
        let fixture = fixture();
        fixture.seed_dev_order(FIRST);

        crash_at(FaultPoint::BeforeStateWrite, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "set_order", "dev").expect("staging");
            fixture.write_dev_order(&mut staged, SECOND);
        });
        assert_eq!(
            fixture.dev_order().as_deref(),
            Some(FIRST),
            "nothing landed"
        );

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert_eq!(fixture.dev_order().as_deref(), Some(FIRST));
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_crash_after_a_child_order_is_written_is_rolled_back() {
        let fixture = fixture();
        fixture.seed_dev_order(FIRST);

        crash_at(FaultPoint::AfterStateWrite, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "set_order", "dev").expect("staging");
            fixture.write_dev_order(&mut staged, SECOND);
        });
        assert_eq!(
            fixture.dev_order().as_deref(),
            Some(SECOND),
            "the new bytes did land, and the change never committed"
        );

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert_eq!(
            fixture.dev_order().as_deref(),
            Some(FIRST),
            "so recovery puts the previous order back"
        );
        assert!(fixture.staging_is_clear());
    }

    /// A cross-parent move writes two order files. A crash between them is the
    /// half-applied case: one folder has been told the entry left and the other
    /// has not been told it arrived.
    #[test]
    fn a_crash_between_two_child_order_writes_undoes_both() {
        let fixture = fixture();
        fixture.vault.create_dir("Other").expect("create Other");
        let other_components = vec!["Other".to_owned()];
        fixture.seed_dev_order(FIRST);
        let other = fixture.vault.open_dir_nofollow("Other").expect("open");
        fsx::create_new(&other, STATE_FILE_NAME, FIRST).expect("seed other");

        crash_at(FaultPoint::AfterStateWrite, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "move", "a1").expect("staging");
            fixture.write_dev_order(&mut staged, SECOND);
            let other = fixture.vault.open_dir_nofollow("Other").expect("open");
            let current = fsx::read_with_identity(&other, STATE_FILE_NAME).ok();
            staged
                .write_state(&other, &other_components, SECOND, current.as_ref())
                .expect("write second order");
        });

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert_eq!(fixture.dev_order().as_deref(), Some(FIRST));
        let other = fixture.vault.open_dir_nofollow("Other").expect("open");
        assert_eq!(
            fsx::read(&other, STATE_FILE_NAME).expect("read").as_slice(),
            FIRST,
            "both folders are back where they started, or neither is"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_committed_change_that_also_moved_an_entry_is_completed_after_a_crash() {
        let fixture = fixture();
        fixture.seed_dev_order(FIRST);

        let mut staged = fixture.stage_both();
        fixture.write_dev_order(&mut staged, SECOND);
        crash_at(FaultPoint::AfterPhaseFlip, move || {
            let _ = staged.commit();
        });

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert!(!fixture.bookmark_is_present(), "the delete is finished");
        assert_eq!(
            fixture.dev_order().as_deref(),
            Some(SECOND),
            "and the order it produced stands"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_state_write_and_an_entry_are_undone_together() {
        let fixture = fixture();
        fixture.seed_dev_order(FIRST);

        let mut staged = fixture.stage_both();
        fixture.write_dev_order(&mut staged, SECOND);
        assert!(!fixture.bookmark_is_present());

        staged.rollback().expect("rollback");

        assert!(fixture.bookmark_is_present());
        assert!(fixture.assets_are_present());
        assert_eq!(fixture.dev_order().as_deref(), Some(FIRST));
        assert!(fixture.staging_is_clear());
    }

    /// The previous release wrote version 2 manifests, which have no order
    /// records at all. A vault upgraded mid-delete still has to be finished or
    /// undone rather than declared unreadable and left to a human.
    #[test]
    fn a_version_2_manifest_from_an_older_build_still_recovers() {
        let fixture = fixture();
        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        fsx::create_dir(&root, "a1-0").expect("op dir");
        let directory = fsx::open_dir(&root, "a1-0").expect("open op");
        fsx::create_new(
            &directory,
            MANIFEST_NAME,
            br#"{"version":2,"operation":"delete_bookmark","phase":"staging","entries":[
               {"origin":["Dev"],"name":"Restored--a1.md","staged":"0-x","kind":"file"}]}"#,
        )
        .expect("manifest");
        fsx::create_new(&directory, "0-x", b"older bytes").expect("staged entry");

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert_eq!(
            fsx::read(&fixture.dev(), "Restored--a1.md").expect("read"),
            b"older bytes",
            "an older manifest is still acted on"
        );
    }

    #[test]
    fn a_manifest_with_an_escaping_order_origin_is_never_acted_on() {
        let fixture = fixture();
        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        fsx::create_dir(&root, "op-0").expect("op dir");
        let directory = fsx::open_dir(&root, "op-0").expect("open op");
        fsx::create_new(
            &directory,
            MANIFEST_NAME,
            br#"{"version":3,"operation":"set_order","phase":"staging","entries":[],
               "states":[{"origin":["..",".."],"backup":"state-0.json","applied":true}]}"#,
        )
        .expect("manifest");
        fsx::create_new(&directory, "state-0.json", b"hostile").expect("backup");

        let retained = recover(&fixture.state, &fixture.vault);
        assert_eq!(retained.len(), 1, "{retained:?}");
        assert!(
            fsx::exists(&directory, "state-0.json"),
            "a record that cannot be trusted is not a licence to write anything"
        );
    }
}
