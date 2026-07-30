//! One reversible change, and recovery from an interrupted one.
//!
//! A multi-step change that acts as it goes cannot be undone: once the third
//! file is gone, a failure on the fourth leaves a vault the daemon can neither
//! complete nor restore. So every step a change takes is *recorded before it is
//! taken*, in a durable manifest, and the record says enough to reverse it.
//!
//! # Four kinds of step
//!
//! A change is an ordered list of actions, and an interrupted one is undone by
//! walking that list backwards:
//!
//! * **stage** — an entry is *renamed* into `<vault>/.bbb/staging/<id>/` rather
//!   than deleted in place, one atomic operation per entry on the same
//!   filesystem, and destroyed only once the change has committed.
//! * **create** — an entry the change brought into existence. Undoing removes
//!   it again.
//! * **relocate** — an entry the change renamed from one folder into another.
//!   Undoing renames it back.
//! * **order** — a folder's `.bbb-state.json`. The previous bytes are copied
//!   into the change's directory first, so undoing restores them; a folder that
//!   had none has the new file removed again.
//!
//! Keeping all four in one list is the point. A create followed by an order
//! write, or a relocation followed by two order writes, is one change as far as
//! a caller is concerned, and a crash in the middle of it must leave the vault
//! at one end or the other — never in a state only the next request could
//! repair. Bolting any of these onto the side of the protocol would reintroduce
//! exactly the failure mode it exists to prevent.
//!
//! # Nothing is undone that is not provably ours
//!
//! Every action that *installed* something records what the operating system
//! called it and, for an order file, the digest of the bytes written. Recovery
//! checks that before reversing anything: if what sits at that name is no
//! longer what this change put there, somebody else has replaced it, and the
//! replacement is left exactly where it is. The action is kept, the manifest is
//! kept, and a person is told. Undoing on the strength of a *name* alone is how
//! a crash turns into data loss.
//!
//! # The manifest is the protocol
//!
//! A rename that no record describes is a file nobody can find again. So the
//! manifest is extended and re-synced *before each step*, never after: a crash
//! between the record and the step leaves a record of something that did not
//! happen, which recovery handles trivially, whereas a crash between the step
//! and the record would leave a file with no way home.
//!
//! The manifest carries a phase, and the transition between the two is the
//! change's point of no return:
//!
//! * `staging` — the change has not logically happened, so an interruption is
//!   **rolled back**.
//! * `committed` — every step has landed and the caller has been told it
//!   succeeded. An interruption is **completed**.
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

use bbb_vault_core::{MAX_DOCUMENT_BYTES, STATE_FILE_NAME};

use crate::fsx::{self, FileIdentity, component};

/// The staging directory's name inside the daemon's state directory.
pub(crate) const STAGING_DIRECTORY: &str = "staging";
/// The manifest's name inside one change's directory.
const MANIFEST_NAME: &str = "manifest.json";

/// The largest manifest this build will read.
///
/// A manifest holds a list rather than a document, so it does not share the
/// document limit — but it is still a file on disk that a crash, a bug or a
/// hostile writer could have grown, and recovery reads it before it trusts
/// anything. Sixteen mebibytes is orders of magnitude above the largest change
/// this daemon makes and far below anything that threatens the process.
const MAX_MANIFEST_BYTES: u64 = 16 * 1024 * 1024;
/// Where retained entries are explained, in the staging root.
const RECOVERY_NAME: &str = "recovery.txt";

/// The manifest format this build writes.
const MANIFEST_VERSION: u32 = 4;

/// The manifest formats this build can act on.
///
/// Version 2 is what the last release wrote: a flat list of staged entries and
/// nothing else, which reads as a list of `stage` actions and recovers exactly
/// as it always did.
///
/// Version 3 is deliberately absent. It existed only between two commits on an
/// unreleased branch and recorded child order writes in a shape this build no
/// longer understands. A manifest claiming it is therefore *retained* rather
/// than acted on — which is the safe answer, because the alternative is a build
/// deciding that a record it cannot read describes nothing.
const RECOVERABLE_VERSIONS: &[u32] = &[2, MANIFEST_VERSION];

/// How far a change has got.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Phase {
    /// Steps are still being taken; an interruption is rolled back.
    Staging,
    /// Every step has landed; an interruption is completed.
    Committed,
}

/// What kind of thing an action names, which decides how it is moved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Kind {
    /// A regular file.
    File,
    /// A directory, moved whole.
    Directory,
}

impl Kind {
    const fn of(is_directory: bool) -> Self {
        if is_directory {
            Self::Directory
        } else {
            Self::File
        }
    }
}

/// One entry moved out of the vault and into this change's directory.
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
    /// What the operating system called it when it was staged.
    ///
    /// Destroying a staged entry is the one place automated cleanup still
    /// recurses, because the user asked for that subtree to go. So it is bound
    /// to this: a staged name holding something else is left alone instead.
    /// Absent in a manifest written before this field existed, which is also
    /// treated as "cannot prove it" and left alone.
    #[serde(default)]
    identity: Option<FileIdentity>,
}

/// One entry this change brought into existence.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Created {
    /// The vault-relative directory it was created in.
    origin: Vec<String>,
    /// The name it was created under.
    name: String,
    /// Whether it is a file or a directory.
    kind: Kind,
    /// What the operating system called it once it existed.
    ///
    /// Absent means the creation was recorded and never happened, which is the
    /// crash window the record exists to make harmless.
    ///
    /// Present narrows what the entry can be, but on its own it does **not**
    /// prove the thing at that name is still the thing this change made — see
    /// `content`.
    #[serde(default)]
    identity: Option<FileIdentity>,
    /// This record's stable identity, independent of where it sits in the list.
    ///
    /// Absent in a manifest written before ids existed; those fall back to a
    /// name derived from the entry's own path, which is stable for the same
    /// reason — one change cannot create the same name in the same folder twice.
    #[serde(default)]
    id: Option<u64>,
    /// The staging name an in-flight undo currently holds this entry under.
    ///
    /// Written to the manifest *before* the claim is attempted and cleared only
    /// once the entry has been disposed of or handed back. Without it a crash
    /// between the two would leave the user's file sitting in staging with
    /// nothing recording that it is there: the next pass would find the origin
    /// empty, call the undo done, drop the action, and then delete the whole
    /// operation directory — and the file with it.
    #[serde(default)]
    claim: Option<String>,
}

/// One entry this change renamed from one folder into another.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Relocated {
    /// The vault-relative directory it came from.
    from: Vec<String>,
    /// The name it had there.
    from_name: String,
    /// The vault-relative directory it went to.
    to: Vec<String>,
    /// The name it has there.
    to_name: String,
    /// Whether it is a file or a directory.
    kind: Kind,
    /// What the operating system called it once it had moved.
    #[serde(default)]
    identity: Option<FileIdentity>,
}

/// One folder's child order file, as this change found it and left it.
///
/// The name inside the folder is always `.bbb-state.json`, so it is not
/// recorded and cannot be redirected by a hand-edited manifest.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Ordered {
    /// The vault-relative directory whose order file this is; empty is the root.
    origin: Vec<String>,
    /// The name, inside the change's directory, holding the bytes that were
    /// there before. Absent when the folder had no order file at all, in which
    /// case undoing means removing the one this change created.
    #[serde(default)]
    backup: Option<String>,
    /// What this change installed, once it landed.
    ///
    /// Absent means the write was recorded and never happened. Present is what
    /// recovery checks the file against before touching it: an order file that
    /// is no longer the one this change wrote belongs to somebody else.
    #[serde(default)]
    installed: Option<Installed>,
}

/// The file one action installed, described well enough to recognise again.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Installed {
    /// The digest of the bytes that were written, as lowercase hexadecimal.
    revision: String,
    /// What the operating system called the file they were written to.
    identity: FileIdentity,
}

impl Installed {
    /// Whether `current` is still the file this action installed.
    ///
    /// Both facts have to agree wherever both are available. Content alone
    /// cannot tell "the file I wrote" from "a different file somebody else
    /// wrote with the same bytes"; identity alone cannot be had on every
    /// platform. Where the platform offers no identity the digest stands on its
    /// own, and that is documented as weaker rather than quietly presented as
    /// the same thing.
    fn still_installed(&self, current: &fsx::Validated) -> bool {
        if current.revision().to_string() != self.revision {
            return false;
        }
        if self.identity.is_known() {
            return current.identity.is_same(self.identity);
        }
        true
    }
}

/// One step a change took, or was about to take.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Action {
    /// An entry moved out of the vault, pending destruction.
    Stage(Entry),
    /// An entry this change created.
    Create(Created),
    /// An entry this change moved between folders.
    Relocate(Relocated),
    /// A folder's child order file this change rewrote.
    Order(Ordered),
}

impl Action {
    /// Checks every field a filesystem operation would be driven from.
    fn validate(&self) -> Result<(), String> {
        match self {
            Self::Stage(entry) => {
                check_components(&entry.origin, "origin")?;
                check_name(&entry.name, "entry name")?;
                check_name(&entry.staged, "staged name")
            }
            Self::Create(created) => {
                check_components(&created.origin, "origin")?;
                check_name(&created.name, "created name")
            }
            Self::Relocate(moved) => {
                check_components(&moved.from, "source")?;
                check_components(&moved.to, "destination")?;
                check_name(&moved.from_name, "source name")?;
                check_name(&moved.to_name, "destination name")
            }
            Self::Order(order) => {
                check_components(&order.origin, "order file's origin")?;
                match &order.backup {
                    Some(backup) => check_name(backup, "backup name"),
                    None => Ok(()),
                }
            }
        }
    }

    /// A line naming this step, for a report a person reads.
    fn describe(&self) -> String {
        match self {
            Self::Stage(entry) => format!(
                "{} belongs in {} as {}",
                entry.staged,
                display(&entry.origin),
                entry.name
            ),
            Self::Create(created) => format!(
                "{} in {} was created by this change and was not removed again",
                created.name,
                display(&created.origin)
            ),
            Self::Relocate(moved) => format!(
                "{} belongs in {} and is in {} as {}",
                moved.from_name,
                display(&moved.from),
                display(&moved.to),
                moved.to_name
            ),
            Self::Order(order) => match &order.backup {
                Some(backup) => format!(
                    "{backup} is the child order {} had before this change",
                    display(&order.origin)
                ),
                None => format!(
                    "{} was given a child order file this change meant to remove again",
                    display(&order.origin)
                ),
            },
        }
    }
}

fn check_components(parts: &[String], label: &str) -> Result<(), String> {
    component::check_all(parts)
        .map_err(|(part, error)| format!("its {label} component `{part}` is unusable: {error}"))
}

fn check_name(value: &str, label: &str) -> Result<(), String> {
    component::check(value).map_err(|error| format!("its {label} `{value}` is unusable: {error}"))
}

fn display(origin: &[String]) -> String {
    if origin.is_empty() {
        "the vault root".to_owned()
    } else {
        origin.join("/")
    }
}

/// The durable record of one change.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Manifest {
    /// The format version, so a build refuses what it cannot read.
    version: u32,
    /// What the change was, for the recovery report.
    operation: String,
    /// How far it got.
    phase: Phase,
    /// Set once recovery has tried and failed to resolve this change.
    ///
    /// It is what lets `bbb doctor` tell a stuck change from one a running
    /// daemon is in the middle of, without either guessing or racing it.
    #[serde(default)]
    retained: bool,
    /// Version 2's flat list of staged entries.
    ///
    /// Read, never written: [`Manifest::normalize`] folds it into `actions` so
    /// that everything below sees one shape.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    entries: Vec<Entry>,
    /// Every step, in the order it was taken.
    #[serde(default)]
    actions: Vec<Action>,
    /// The next stable action id to hand out.
    ///
    /// Monotonic and never reused. A position in `actions` is not an identity:
    /// recovery drops the steps it reverses, so an index means something
    /// different on the next pass. Anything that has to survive that — a staged
    /// claim name, above all — is keyed on one of these instead.
    #[serde(default)]
    next_action_id: u64,
    /// Entries an undo moved out of the vault but deliberately did not destroy.
    ///
    /// Automated recovery cannot prove it owns what it is about to delete — a
    /// recycled inode carrying identical bytes is indistinguishable from the
    /// entry this change wrote — and it cannot prove a deletion hits the object
    /// it checked, because unlink addresses a name. So it does neither. The
    /// entry is moved here, where the vault is restored and the bytes still
    /// exist, and a person or `bbb doctor` decides what to do with it.
    #[serde(default)]
    quarantined: Vec<Quarantined>,
}

/// An entry held in staging because destroying it could not be justified.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Quarantined {
    /// The name it has inside the change's directory.
    staged: String,
    /// The vault-relative directory it was taken out of.
    origin: Vec<String>,
    /// The name it had there.
    name: String,
    /// Whether it is a file or a directory.
    kind: Kind,
}

impl Quarantined {
    /// A line for the recovery report.
    fn describe(&self) -> String {
        format!(
            "{} was created by this change, moved out of {} and kept rather than deleted",
            self.staged,
            display(&self.origin)
        )
    }
}

impl Manifest {
    /// Hands out the next stable action id.
    ///
    /// Saturating rather than wrapping: reusing an id would let two records
    /// claim the same staging name, and a counter that has reached `u64::MAX` is
    /// a broken manifest rather than a busy one.
    fn allocate_action_id(&mut self) -> u64 {
        let id = self.next_action_id;
        self.next_action_id = self.next_action_id.saturating_add(1);
        id
    }

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
            Action::Stage(entry.clone()).validate()?;
        }
        for action in &self.actions {
            action.validate()?;
        }
        Ok(())
    }

    /// Presents an older manifest in the one shape everything below expects.
    fn normalize(&mut self) {
        if self.entries.is_empty() {
            return;
        }
        // Version 2 had no other kind of step, so its entries are the whole
        // list and go in front of one that is empty anyway.
        let mut actions: Vec<Action> = self.entries.drain(..).map(Action::Stage).collect();
        actions.append(&mut self.actions);
        self.actions = actions;
        self.version = MANIFEST_VERSION;
    }

    /// Whether this change has anything left that needs undoing or removing.
    /// Whether nothing is left for recovery to do *or* to hand to a person.
    ///
    /// A quarantined entry counts: the operation directory is what is holding it,
    /// so an empty action list is not permission to remove that directory.
    fn is_empty(&self) -> bool {
        self.actions.is_empty() && self.quarantined.is_empty()
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
    /// After every step has landed, before the phase becomes `committed`.
    BeforePhaseFlip,
    /// Immediately after the phase becomes `committed`.
    AfterPhaseFlip,
    /// Part-way through destroying what the change superseded.
    MidDestroy,
    /// After an entry is recorded, immediately before it is claimed.
    ///
    /// A test interposes here to replace the entry, which is the race the
    /// verified claim exists to survive.
    BeforeClaim,
    /// During recovery, immediately before an undo claims what it will remove.
    ///
    /// A test interposes here to replace the entry, which is the race a
    /// verify-then-remove undo would lose and a verified claim survives.
    BeforeUndoClaim,
    /// During recovery, once an undo holds the entry and before it removes it.
    ///
    /// The origin name is free at this instant. A test interposes here to put
    /// something new there, which an undo that removed *by name* would destroy
    /// and one that removes the object it claimed cannot even see.
    AfterUndoClaim,
    /// After a create is recorded, before the entry exists.
    BeforeCreate,
    /// Immediately after a created entry exists.
    AfterCreate,
    /// After a relocation is recorded, before the entry moves.
    BeforeRelocate,
    /// Immediately after a relocated entry has moved.
    AfterRelocate,
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

/// The prefix every simulated-crash panic carries.
///
/// The test hook that keeps these quiet matches on it, so the two must agree;
/// they are written once, here, for that reason.
#[cfg(test)]
const SIMULATED_CRASH: &str = "simulated crash at";

#[cfg(test)]
fn trip(point: FaultPoint) {
    let armed = FAULT.with(std::cell::Cell::get);
    assert!(armed != Some(point), "{SIMULATED_CRASH} {point:?}");

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

/// One in-flight change, under a single durable record.
#[derive(Debug)]
pub(crate) struct Staged {
    /// The `.bbb/staging/<id>` handle everything is renamed into.
    directory: Dir,
    /// The staging root, so the change's directory can be removed.
    root: Dir,
    /// The vault root, used to resolve an origin when undoing.
    vault: Dir,
    /// This change's directory name inside the staging root.
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
            actions: Vec::new(),
            next_action_id: 0,
            quarantined: Vec::new(),
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

    /// Records `action` durably, before the step it describes is taken.
    fn record(&mut self, action: Action) -> io::Result<()> {
        self.manifest.actions.push(action);
        write_manifest(&self.directory, &self.manifest)
    }

    /// Drops the last record, for a step that turned out not to happen.
    fn forget(&mut self) {
        self.manifest.actions.pop();
        let _ = write_manifest(&self.directory, &self.manifest);
    }

    /// Moves `name` out of `origin` and into staging.
    ///
    /// `origin_components` is the origin's vault-relative path, which is what
    /// recovery uses to find it again in a later process.
    ///
    /// # Errors
    ///
    /// Returns any I/O error. The caller should [`Staged::rollback`]; steps
    /// already taken remain reversible.
    pub(crate) fn take(
        &mut self,
        origin: &Dir,
        origin_components: &[String],
        name: &str,
        is_directory: bool,
        expected: FileIdentity,
    ) -> Result<(), TakeError> {
        component::check_all(origin_components)
            .map_err(|(part, error)| TakeError::Io(invalid(&part, &error.to_string())))?;
        component::check(name).map_err(|error| TakeError::Io(invalid(name, &error.to_string())))?;

        // Staged names are positional, so two entries with the same name from
        // different directories cannot collide with each other.
        let staged = format!("{}-{}", self.manifest.actions.len(), sanitize(name));
        // Recorded before the move, so a crash can never orphan the entry.
        self.record(Action::Stage(Entry {
            origin: origin_components.to_vec(),
            name: name.to_owned(),
            staged: staged.clone(),
            kind: Kind::of(is_directory),
            identity: Some(expected),
        }))
        .map_err(TakeError::Io)?;

        if self.manifest.actions.len() == 1 {
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
                // Both of these mean the entry really is in staging, so the
                // record must stay: forgetting it is how the entry becomes
                // unreachable to every later recovery pass.
                let orphaned = matches!(
                    error,
                    fsx::ClaimError::UndoFailed { .. } | fsx::ClaimError::Stranded { .. }
                );
                if !orphaned {
                    self.forget();
                }
                Err(match error {
                    fsx::ClaimError::NotTheSameEntry => TakeError::NotTheSameEntry,
                    fsx::ClaimError::Io(error) => TakeError::Io(error),
                    fsx::ClaimError::UndoFailed { cause, .. }
                    | fsx::ClaimError::Stranded { cause } => TakeError::Orphaned(cause),
                })
            }
        }
    }

    /// Creates a file as part of this change, recording it first.
    ///
    /// # Errors
    ///
    /// Returns [`io::ErrorKind::AlreadyExists`] when the name is taken — which
    /// a caller allocating a name treats as "try the next one" — and any other
    /// I/O error. Nothing is left recorded for a creation that did not happen.
    pub(crate) fn create_file(
        &mut self,
        origin: &Dir,
        origin_components: &[String],
        name: &str,
        bytes: &[u8],
    ) -> io::Result<()> {
        self.record_creation(origin_components, name, Kind::File)?;
        trip(FaultPoint::BeforeCreate);
        match fsx::create_new(origin, name, bytes) {
            Ok(()) => self.confirm_creation(origin, name, Kind::File),
            Err(error) => {
                self.forget();
                Err(error)
            }
        }
    }

    /// Creates a directory as part of this change, recording it first.
    ///
    /// # Errors
    ///
    /// As [`Staged::create_file`].
    pub(crate) fn create_directory(
        &mut self,
        origin: &Dir,
        origin_components: &[String],
        name: &str,
    ) -> io::Result<()> {
        self.record_creation(origin_components, name, Kind::Directory)?;
        trip(FaultPoint::BeforeCreate);
        match fsx::create_dir(origin, name) {
            Ok(()) => self.confirm_creation(origin, name, Kind::Directory),
            Err(error) => {
                self.forget();
                Err(error)
            }
        }
    }

    fn record_creation(
        &mut self,
        origin_components: &[String],
        name: &str,
        kind: Kind,
    ) -> io::Result<()> {
        component::check_all(origin_components)
            .map_err(|(part, error)| invalid(&part, &error.to_string()))?;
        component::check(name).map_err(|error| invalid(name, &error.to_string()))?;
        let id = self.manifest.allocate_action_id();
        self.record(Action::Create(Created {
            origin: origin_components.to_vec(),
            name: name.to_owned(),
            kind,
            identity: None,
            id: Some(id),
            claim: None,
        }))
    }

    /// Records what the new entry turned out to be, so an undo can recognise it.
    ///
    /// `content` is the revision of the bytes just written, for a file, and
    /// `None` for a directory. Both halves are needed: see [`Created::content`].
    fn confirm_creation(&mut self, origin: &Dir, name: &str, kind: Kind) -> io::Result<()> {
        let identity = identity_of(origin, name, kind)?;
        if let Some(Action::Create(created)) = self.manifest.actions.last_mut() {
            created.identity = Some(identity);
        }
        write_manifest(&self.directory, &self.manifest)?;
        trip(FaultPoint::AfterCreate);
        Ok(())
    }

    /// Renames an entry between folders as part of this change.
    ///
    /// # Errors
    ///
    /// Returns [`io::ErrorKind::AlreadyExists`] when the destination name is
    /// taken, and any other I/O error. Nothing is left recorded for a move that
    /// did not happen.
    pub(crate) fn relocate(
        &mut self,
        from: Place<'_>,
        to: Place<'_>,
        is_directory: bool,
    ) -> io::Result<()> {
        component::check_all(from.components)
            .map_err(|(part, error)| invalid(&part, &error.to_string()))?;
        component::check_all(to.components)
            .map_err(|(part, error)| invalid(&part, &error.to_string()))?;

        let kind = Kind::of(is_directory);
        self.record(Action::Relocate(Relocated {
            from: from.components.to_vec(),
            from_name: from.name.to_owned(),
            to: to.components.to_vec(),
            to_name: to.name.to_owned(),
            kind,
            identity: None,
        }))?;
        trip(FaultPoint::BeforeRelocate);

        let moved = if is_directory {
            fsx::move_dir(from.dir, from.name, to.dir, to.name)
        } else {
            fsx::move_file(from.dir, from.name, to.dir, to.name)
        };
        if let Err(error) = moved {
            self.forget();
            return Err(error);
        }

        let identity = identity_of(to.dir, to.name, kind)?;
        if let Some(Action::Relocate(record)) = self.manifest.actions.last_mut() {
            record.identity = Some(identity);
        }
        write_manifest(&self.directory, &self.manifest)?;
        trip(FaultPoint::AfterRelocate);
        Ok(())
    }

    /// Writes one folder's child order file as part of this change.
    ///
    /// `folder` must be the folder's own directory handle, and `current` the
    /// order file as it was read from it — which is what binds the write to the
    /// exact file whose revision the caller checked. Pass `None` when the
    /// folder has no order file yet; one is then created, and undoing means
    /// removing it again.
    ///
    /// The previous bytes are copied into this change's directory and named in
    /// the manifest *before* anything is written, so an interrupted run has a
    /// record of both what changed and what it used to be.
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
                let name = format!("state-{}.json", self.manifest.actions.len());
                fsx::create_new(&self.directory, &name, &current.bytes)?;
                Some(name)
            }
            None => None,
        };

        self.record(Action::Order(Ordered {
            origin: folder_components.to_vec(),
            backup: backup.clone(),
            installed: None,
        }))?;
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
            self.forget();
            if let Some(backup) = backup {
                let _ = fsx::remove_file(&self.directory, &backup);
            }
            return Err(error);
        }

        // What was installed, so recovery can tell it from a file somebody else
        // put there afterwards.
        let installed =
            fsx::read_with_identity(folder, STATE_FILE_NAME).map(|written| Installed {
                revision: written.revision().to_string(),
                identity: written.identity,
            })?;
        if let Some(Action::Order(record)) = self.manifest.actions.last_mut() {
            record.installed = Some(installed);
        }
        write_manifest(&self.directory, &self.manifest)?;
        trip(FaultPoint::AfterStateWrite);
        Ok(())
    }

    /// Commits the change: flips the phase, then destroys what it superseded.
    ///
    /// The phase flip is the point of no return. After it, an interrupted run
    /// is completed rather than undone, because the caller has been told the
    /// change succeeded.
    ///
    /// # Errors
    ///
    /// Returns an I/O error only from the phase flip, which happens before
    /// anything is destroyed. A later failure to destroy leaves entries for
    /// recovery to finish, and is not reported as a failed change, because the
    /// vault no longer references them.
    pub(crate) fn commit(mut self) -> io::Result<()> {
        trip(FaultPoint::BeforePhaseFlip);
        self.manifest.phase = Phase::Committed;
        write_manifest(&self.directory, &self.manifest)?;
        trip(FaultPoint::AfterPhaseFlip);

        destroy(&self.directory, &self.manifest);
        // The same teardown recovery uses, and for the same reason: `destroy`
        // refuses anything it cannot identify, and an unconditional recursive
        // removal here would take exactly what it just declined to touch. What
        // it leaves stays for recovery and `bbb doctor` to describe — the change
        // itself has committed, so residue is not a failure.
        if let Err(leftovers) =
            discard_operation_directory(&self.root, &self.name, self.directory, &self.manifest)
        {
            tracing::info!(
                operation = %self.manifest.operation,
                kept = leftovers.len(),
                "a committed change left entries that could not be identified; they are kept"
            );
        }
        Ok(())
    }

    /// Reverses every step this change took, newest first.
    ///
    /// # Errors
    ///
    /// Returns the first failure, having attempted everything. Anything that
    /// could not be undone stays recorded, so recovery and `bbb doctor` can
    /// still describe it.
    pub(crate) fn rollback(mut self) -> io::Result<()> {
        let outcome = undo_all(&self.directory, &self.vault, &mut self.manifest);
        let _ = write_manifest(&self.directory, &self.manifest);

        if self.manifest.is_empty() {
            // Same teardown as recovery: proved empty, then non-recursive. A
            // rollback that quarantined something leaves the directory holding
            // it, so `is_empty` is false and nothing here runs.
            let _ =
                discard_operation_directory(&self.root, &self.name, self.directory, &self.manifest);
        }
        outcome
    }
}

/// One end of a rename: a directory handle, its vault-relative path, and a name.
///
/// The three always travel together — the handle does the work, the components
/// go into the manifest so a later process can find the same directory, and the
/// name is what is being moved.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Place<'a> {
    /// The directory handle, opened no-follow.
    pub(crate) dir: &'a Dir,
    /// Its vault-relative path, as validated components.
    pub(crate) components: &'a [String],
    /// The entry's name inside it.
    pub(crate) name: &'a str,
}

/// The identity of whatever sits at `name`, file or directory.
///
/// Asking which object this is costs a handle, not the file's contents. Reading
/// the bytes to reach the identity that came with them is how a question about a
/// file the daemon did not write becomes an allocation the size of it.
fn identity_of(dir: &Dir, name: &str, kind: Kind) -> io::Result<FileIdentity> {
    match kind {
        Kind::Directory => fsx::directory_identity(&fsx::open_dir(dir, name)?),
        Kind::File => fsx::file_identity(dir, name),
    }
}

/// A change whose steps could not be reversed automatically.
#[derive(Debug, Clone)]
pub(crate) struct Retained {
    /// The staging directory holding them, relative to the vault.
    pub(crate) directory: String,
    /// What the interrupted change was.
    pub(crate) operation: String,
    /// A line per step, naming what is where.
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

/// Every change that needs a person, with the reason.
///
/// Read-only, and the single definition of "this needs attention", so `doctor`
/// cannot disagree with recovery about what counts. Two things qualify:
///
/// * a change recovery marked `retained`, meaning it tried and could not
///   resolve it, and
/// * a change whose manifest is missing, unparseable, or fails validation — a
///   record the daemon will never act on, so it will never clear itself.
///
/// A valid manifest without the flag belongs to a change a daemon is in the
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
            // A live change: a daemon is mid-flight and will clear this up.
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
            if let Some(Action::Stage(entry)) = staged.manifest.actions.last_mut() {
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

/// Finishes or undoes every change a previous run left behind.
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
                entries: staged_entry_names(&directory).unwrap_or_else(|error| {
                    vec![format!(
                        "its contents could not be listed: {}",
                        error.kind()
                    )]
                }),
                reason,
            });
        }
    };

    match manifest.phase {
        Phase::Staging => {
            let outcome = undo_all(&directory, vault, &mut manifest);
            let _ = write_manifest(&directory, &manifest);
            if manifest.is_empty() {
                // Nothing is outstanding and nothing is quarantined, so the
                // directory should hold only its manifest. Proving that — and
                // removing it non-recursively — is what stops a teardown from
                // taking an entry that a record could not describe, or one that
                // arrived while this was deciding.
                // The flag has to reach disk before the teardown, because the
                // teardown takes the handle: a refusal before the removal leaves
                // the manifest as it was found, and a failure after it writes
                // back this same record. Same end state as setting the flag
                // afterwards used to give — the cost is one durable write on the
                // path that then deletes the file it just wrote.
                manifest.retained = true;
                let _ = write_manifest(&directory, &manifest);
                match discard_operation_directory(root, name, directory, &manifest) {
                    Ok(()) => {
                        tracing::info!(
                            operation = %manifest.operation,
                            "rolled back a change interrupted before it committed"
                        );
                        return None;
                    }
                    Err(leftovers) => {
                        return Some(Retained {
                            directory: staged_path(name),
                            operation: manifest.operation.clone(),
                            entries: leftovers,
                            reason: "it holds entries that no record accounts for, so none of \
                                     them were removed"
                                .to_owned(),
                        });
                    }
                }
            }
            manifest.retained = true;
            let _ = write_manifest(&directory, &manifest);
            let mut entries: Vec<String> = manifest.actions.iter().map(Action::describe).collect();
            entries.extend(manifest.quarantined.iter().map(Quarantined::describe));
            let reason = outcome.err().map_or_else(
                || "they were taken out of the vault and kept rather than deleted".to_owned(),
                |error| error.to_string(),
            );
            Some(Retained {
                directory: staged_path(name),
                operation: manifest.operation.clone(),
                entries,
                reason,
            })
        }
        Phase::Committed => {
            destroy(&directory, &manifest);
            // As above: the flag reaches disk while the handle is still here,
            // because the teardown takes it.
            manifest.retained = true;
            let _ = write_manifest(&directory, &manifest);
            let leftovers = match discard_operation_directory(root, name, directory, &manifest) {
                Ok(()) => {
                    tracing::info!(
                        operation = %manifest.operation,
                        "completed a change interrupted after it committed"
                    );
                    return None;
                }
                Err(leftovers) => leftovers,
            };
            Some(Retained {
                directory: staged_path(name),
                operation: manifest.operation,
                entries: leftovers,
                reason: "they could not be removed".to_owned(),
            })
        }
    }
}

/// Reverses every step, dropping from `manifest` the ones that succeed.
///
/// Newest first, so the list unwinds exactly the way it was built: an order
/// file goes back before the entry it describes, and a directory staged before
/// its former contents is put back before them.
///
/// A step whose record says it never happened counts as reversed — the manifest
/// is written first on purpose.
fn undo_all(directory: &Dir, vault: &Dir, manifest: &mut Manifest) -> io::Result<()> {
    let mut failure = None;

    // Descending indices, and the manifest is written after every step. Two
    // reasons, both about what a crash mid-loop leaves behind:
    //
    // * An undo may record durable state into the very manifest being walked —
    //   a held claim — so the list cannot be rebuilt at the end from a snapshot
    //   taken at the start. Doing that is how a claim write for one action
    //   resurrects an action already completed.
    // * Removing a completed action as it completes means a crash leaves a
    //   manifest describing exactly the work still outstanding, so the next pass
    //   neither repeats a step nor forgets one.
    //
    // Descending order also makes the removal cheap and index-stable: taking
    // element `index` out does not move anything below it.
    for index in (0..manifest.actions.len()).rev() {
        match undo_one(directory, vault, manifest, index) {
            Ok(()) => {
                manifest.actions.remove(index);
            }
            Err(error) => {
                failure.get_or_insert(error);
            }
        }
        // Persisted per action, not once at the end.
        write_manifest(directory, manifest)?;
    }

    match failure {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn undo_one(directory: &Dir, vault: &Dir, manifest: &mut Manifest, index: usize) -> io::Result<()> {
    let action = manifest.actions[index].clone();
    // Validated at the point of use: this is reachable from recovery, whose
    // manifest came off disk, and from rollback, whose did not.
    action
        .validate()
        .map_err(|reason| io::Error::new(io::ErrorKind::InvalidInput, reason))?;

    match action {
        Action::Stage(entry) => undo_stage(directory, vault, &entry),
        Action::Create(created) => undo_create(directory, vault, manifest, index, &created),
        Action::Relocate(moved) => undo_relocate(vault, &moved),
        Action::Order(order) => undo_order(directory, vault, &order),
    }
}

fn undo_stage(directory: &Dir, vault: &Dir, entry: &Entry) -> io::Result<()> {
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

/// Takes an entry the change created back out of the vault — and keeps it.
///
/// It does **not** delete it, and that is the design rather than a shortcoming.
/// Automated recovery cannot establish either half of what a delete would need:
///
/// * **Ownership.** An inode number is recycled the moment the file it named is
///   unlinked, so a file a user put at this name can carry the number the
///   manifest recorded. Comparing content does not settle it either — a
///   byte-identical replacement, or an empty replacement directory, matches
///   whatever we recorded. There is no portable mark we can put on an object at
///   creation and recognise later, so this is not a check waiting to be written.
/// * **The delete itself.** `unlink` and `rmdir` address a *name* on every
///   platform; there is no "unlink this handle". Verifying and then unlinking is
///   always two operations with a gap.
///
/// So the entry is *claimed* — moved into the change's own directory, atomically
/// and bound to the recorded identity by [`fsx::claim_verified`] — and left
/// there. The vault is restored, which is what an undo is for. The bytes are
/// still on disk, which is what matters when the alternative is guessing. The
/// operation directory then survives to hold it, and `bbb doctor` reports it for
/// a person to discard.
///
/// The claim is recorded in the manifest before it is attempted and moved to the
/// quarantine list once it lands, so a crash at any point leaves something that
/// accounts for what is on disk.
fn undo_create(
    directory: &Dir,
    vault: &Dir,
    manifest: &mut Manifest,
    index: usize,
    created: &Created,
) -> io::Result<()> {
    let Some(identity) = created.identity else {
        // Recorded and never confirmed, so nothing describes what the entry is.
        // "It was never created" is an inference, and the old code made it
        // silently — leaving a stray entry in the vault that nothing accounted
        // for whenever the crash landed on the far side of the create.
        //
        // The inference is also unnecessary: whether something is at that name
        // is a question with an answer. Only "yes" is a problem, and it is
        // reported rather than acted on, because with no recorded identity there
        // is nothing that could prove the entry is this change's to touch.
        let origin = fsx::open_components(vault, &created.origin)?;
        if fsx::exists(&origin, &created.name) {
            return Err(unconfirmed(created));
        }
        return Ok(());
    };
    let is_directory = matches!(created.kind, Kind::Directory);
    let claim = claim_name_for(created);

    if created.claim.is_some() {
        if fsx::exists(directory, &claim) {
            // A previous pass claimed it and stopped there. The origin is not
            // consulted: its being empty is this undo's own doing.
            return quarantine(directory, manifest, index, created, &claim);
        }
        // Recorded, but nothing is there: the crash landed before the claim took
        // effect. Forget it and try again from the origin.
        record_claim(directory, manifest, index, None)?;
    }

    let origin = fsx::open_components(vault, &created.origin)?;

    // Recorded before the attempt, so no claim can exist unaccounted for.
    record_claim(directory, manifest, index, Some(claim.clone()))?;

    trip(FaultPoint::BeforeUndoClaim);

    match fsx::claim_verified(
        &origin,
        &created.name,
        directory,
        &claim,
        is_directory,
        identity,
    ) {
        Ok(()) => {}
        // Replaced, or an identity this platform cannot vouch for. Nothing moved.
        Err(fsx::ClaimError::NotTheSameEntry) => {
            record_claim(directory, manifest, index, None)?;
            return Err(left_alone(created));
        }
        // Already gone. Reachable only on a pass holding no claim, so an empty
        // origin really is somebody else's doing.
        Err(fsx::ClaimError::Io(error)) if error.kind() == io::ErrorKind::NotFound => {
            record_claim(directory, manifest, index, None)?;
            return Ok(());
        }
        Err(fsx::ClaimError::Io(error)) => {
            record_claim(directory, manifest, index, None)?;
            return Err(error);
        }
        // Both of these leave the entry in staging under `claim`, so the record
        // of it stays exactly where it is.
        Err(fsx::ClaimError::UndoFailed { cause } | fsx::ClaimError::Stranded { cause }) => {
            return Err(cause);
        }
    }

    trip(FaultPoint::AfterUndoClaim);

    quarantine(directory, manifest, index, created, &claim)
}

/// Moves a claimed entry from "in flight" to "kept for a person", durably.
fn quarantine(
    directory: &Dir,
    manifest: &mut Manifest,
    index: usize,
    created: &Created,
    claim: &str,
) -> io::Result<()> {
    if let Some(Action::Create(record)) = manifest.actions.get_mut(index) {
        record.claim = None;
    }
    // A resumed pass may already have listed it.
    if !manifest.quarantined.iter().any(|held| held.staged == claim) {
        manifest.quarantined.push(Quarantined {
            staged: claim.to_owned(),
            origin: created.origin.clone(),
            name: created.name.clone(),
            kind: created.kind,
        });
    }
    write_manifest(directory, manifest)
}

/// The staging name an undo holds a created entry under.
///
/// Derived from the record's stable id, so it is the same name on every pass
/// however the action list has been rewritten in between. A manifest from before
/// ids existed falls back to the entry's own path, which is stable for the same
/// reason: one change cannot create the same name in the same folder twice.
fn claim_name_for(created: &Created) -> String {
    if let Some(id) = created.id {
        return format!("undo-{id}-{}", sanitize(&created.name));
    }
    let mut key = String::from("undo-legacy");
    for component in &created.origin {
        key.push('-');
        key.push_str(&sanitize(component));
    }
    format!("{key}-{}", sanitize(&created.name))
}

/// Writes the claim state of one created record through to disk.
fn record_claim(
    directory: &Dir,
    manifest: &mut Manifest,
    index: usize,
    claim: Option<String>,
) -> io::Result<()> {
    if let Some(Action::Create(created)) = manifest.actions.get_mut(index) {
        created.claim = claim;
    }
    write_manifest(directory, manifest)
}

/// Why an entry was left where it was.
fn left_alone(created: &Created) -> io::Error {
    replaced(&format!(
        "`{}` in {} is no longer the entry this change created, so it was left alone",
        created.name,
        display(&created.origin)
    ))
}

/// Why a creation that was never confirmed cannot be undone automatically.
fn unconfirmed(created: &Created) -> io::Error {
    replaced(&format!(
        "`{}` in {} was recorded as being created and never confirmed, so whether it exists is \
         unknown and it was left untouched",
        created.name,
        display(&created.origin)
    ))
}

/// Renames a moved entry back — but only if it is still that entry.
fn undo_relocate(vault: &Dir, moved: &Relocated) -> io::Result<()> {
    let Some(identity) = moved.identity else {
        // Recorded and never moved.
        return Ok(());
    };
    let destination = fsx::open_components(vault, &moved.to)?;
    let current = match identity_of(&destination, &moved.to_name, moved.kind) {
        Ok(current) => current,
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            return Err(replaced(&format!(
                "`{}` is no longer in {}, so it could not be put back in {}",
                moved.to_name,
                display(&moved.to),
                display(&moved.from)
            )));
        }
        Err(error) => return Err(error),
    };
    if !identity.is_known() || !current.is_same(identity) {
        return Err(replaced(&format!(
            "`{}` in {} is no longer the entry this change moved there, so it was left alone",
            moved.to_name,
            display(&moved.to)
        )));
    }

    let origin = fsx::open_components(vault, &moved.from)?;
    match moved.kind {
        Kind::Directory => fsx::move_dir(&destination, &moved.to_name, &origin, &moved.from_name),
        Kind::File => fsx::move_file(&destination, &moved.to_name, &origin, &moved.from_name),
    }
}

/// Puts one folder's child order file back the way this change found it.
///
/// The whole of this function is one rule: **never touch an order file this
/// change did not install**. A `.bbb-state.json` that has been rewritten since
/// — by a sync client, by another editor, by a later daemon — is somebody's
/// current order, and restoring a backup over it or deleting it outright would
/// destroy work nobody asked to lose. So the file is identified before it is
/// touched, and anything unrecognised is kept and reported instead.
fn undo_order(directory: &Dir, vault: &Dir, order: &Ordered) -> io::Result<()> {
    let Some(installed) = &order.installed else {
        // Recorded and never written, so the folder still has whatever it had.
        // The backup taken in preparation is redundant and goes with the record.
        return match &order.backup {
            Some(backup) => discard_backup(directory, backup),
            None => Ok(()),
        };
    };

    let folder = fsx::open_components(vault, &order.origin)?;
    let current = match fsx::read_with_identity_within(&folder, STATE_FILE_NAME, MAX_DOCUMENT_BYTES)
    {
        Ok(Some(current)) if installed.still_installed(&current) => current,
        Ok(None) => {
            return Err(replaced(&format!(
                "the child order file in {} is larger than the {MAX_DOCUMENT_BYTES} byte limit, \
                 so it was not read and was left exactly as it is",
                display(&order.origin)
            )));
        }
        Ok(Some(_)) => {
            return Err(replaced(&format!(
                "the child order file in {} has been rewritten since this change installed it, so \
                 it was left exactly as it is; the order this change replaced is kept beside the \
                 manifest",
                display(&order.origin)
            )));
        }
        // Somebody removed it. There is nothing of theirs to protect, and
        // putting the previous order back is what was wanted.
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let Some(backup) = &order.backup else {
                return Ok(());
            };
            let bytes = read_backup(directory, backup)?;
            // Nothing is at the name — somebody removed it — so creating is the
            // whole operation and a racing writer loses to `create_new`.
            fsx::create_new(&folder, STATE_FILE_NAME, &bytes)?;
            return discard_backup(directory, backup);
        }
        Err(error) => return Err(error),
    };

    match &order.backup {
        Some(backup) => {
            let bytes = read_backup(directory, backup)?;
            // Compare-and-set against the file this change installed, rather
            // than a write aimed at the name. `write_replacing` would overwrite
            // whatever is there by the time it lands; this refuses instead, so a
            // replacement written in the meantime is never destroyed.
            match fsx::replace_validated(&folder, STATE_FILE_NAME, &bytes, &current) {
                Ok(()) => discard_backup(directory, backup),
                Err(fsx::CommitError::Stale) => Err(replaced(&format!(
                    "the child order file in {} changed while it was being put back, so it was \
                     left exactly as it is; the order this change replaced is kept beside the \
                     manifest",
                    display(&order.origin)
                ))),
                Err(
                    fsx::CommitError::Io(error) | fsx::CommitError::UndoFailed { cause: error, .. },
                ) => Err(error),
            }
        }
        // The folder had no order file, so this change created it and undoing
        // means it should have none again.
        None => fsx::remove_file(&folder, STATE_FILE_NAME),
    }
}

/// Reads an order-file backup, bounded like every other recovery read.
fn read_backup(directory: &Dir, backup: &str) -> io::Result<Vec<u8>> {
    fsx::read_within(directory, backup, MAX_DOCUMENT_BYTES)?.ok_or_else(|| {
        io::Error::other(format!(
            "the kept child order file is larger than the {MAX_DOCUMENT_BYTES} byte limit"
        ))
    })
}

/// Drops an order-file backup once its bytes are safely back in the vault.
///
/// Leaving it would be harmless in itself — the same bytes are now in the folder
/// — but it would leave the staging directory holding something after every step
/// was reversed, and that is the signal recovery uses to tell "finished" from
/// "something is in here that no record accounts for". A backup that outlives its
/// record would make that signal permanently untrustworthy.
fn discard_backup(directory: &Dir, backup: &str) -> io::Result<()> {
    match fsx::remove_file(directory, backup) {
        Ok(()) => Ok(()),
        // Already gone is the state that was wanted.
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

/// The refusal that keeps somebody else's file exactly where it is.
fn replaced(reason: &str) -> io::Error {
    io::Error::new(io::ErrorKind::AlreadyExists, reason.to_owned())
}

/// Removes everything a committed change superseded.
///
/// Staged entries are the ones the change deleted; order backups hold bytes the
/// daemon itself wrote a moment earlier and has now replaced. A created or
/// relocated entry is the change's *result* and is left exactly where it is.
///
/// # What a staged subtree means here
///
/// This is the only cleanup in the crate that still deletes a tree, so it is
/// worth being exact about how far the guarantee reaches.
///
/// The **root** of a staged subtree is identity-bound: [`fsx::remove_staged`]
/// re-checks it against the identity captured when the entry was staged, and a
/// staged name holding anything else — or a record too old to name what it held —
/// is left for a person. Nothing here starts recursing into an entry it has not
/// identified.
///
/// Its **descendants are not individually proved, by design.** The user asked for
/// the subtree to be deleted; it was moved into staging whole for exactly that,
/// and the change has already committed, so the caller has been told it is gone.
/// Per-child identities were never recorded and recording them would answer the
/// wrong question — the request was for the tree.
///
/// The cost is the window. The check is one syscall, the traversal is many, so
/// anything created *inside* the subtree while it is being walked will probably be
/// removed with it. Nothing in the vault can reach in there — the subtree is
/// already out of it and inside the daemon's own staging directory — so the
/// exposure is to another writer in `.bbb/staging`, which is the same trust
/// boundary every other staged entry sits behind. It is accepted here and
/// nowhere else: this deletion is the operation the user is waiting on, not
/// housekeeping recovery decided to do on its own.
fn destroy(directory: &Dir, manifest: &Manifest) {
    for (index, action) in manifest.actions.iter().enumerate() {
        if index > 0 {
            trip(FaultPoint::MidDestroy);
        }
        if action.validate().is_err() {
            // Unreachable for a manifest that came through `read_manifest`;
            // refusing here as well means no future caller can bypass it.
            continue;
        }
        let removed = match action {
            // The user asked for this subtree to go, which is why this is the one
            // cleanup that may still recurse. It is bound to the identity taken
            // when the entry was staged, so a staged name holding anything else
            // — or a record too old to say what it held — is left for a person.
            Action::Stage(entry) => match entry.identity {
                Some(identity) => fsx::remove_staged(
                    directory,
                    &entry.staged,
                    matches!(entry.kind, Kind::Directory),
                    identity,
                ),
                None => Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "the record does not say what was staged, so it was left alone",
                )),
            },
            Action::Order(order) => match &order.backup {
                Some(backup) => fsx::remove_file(directory, backup),
                None => Ok(()),
            },
            Action::Create(_) | Action::Relocate(_) => Ok(()),
        };
        if let Err(error) = removed
            && error.kind() != io::ErrorKind::NotFound
        {
            tracing::warn!(
                error = %error.kind(),
                "a superseded entry could not be destroyed; it is kept for the next recovery"
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
    let bytes = fsx::read_within(directory, MANIFEST_NAME, MAX_MANIFEST_BYTES)
        .map_err(|error| format!("its manifest could not be read: {}", error.kind()))?
        .ok_or_else(|| {
            format!("its manifest is larger than the {MAX_MANIFEST_BYTES} byte limit")
        })?;
    let mut manifest: Manifest = serde_json::from_slice(&bytes)
        .map_err(|error| format!("its manifest is not readable: {error}"))?;
    // Every field is checked before a single filesystem name is built from it.
    // A manifest that fails here is never acted on: see `recover_one`.
    manifest.validate()?;
    manifest.normalize();
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

/// Everything in a change's directory except its manifest.
///
/// An error is an error, never an empty list. Reporting "nothing is in here"
/// because the directory could not be read is how a teardown deletes a directory
/// full of the user's entries.
fn staged_entry_names(directory: &Dir) -> io::Result<Vec<String>> {
    let mut names = Vec::new();
    for entry in directory.entries()? {
        let entry = entry?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            return Err(io::Error::other(
                "a staged entry has a name this process cannot represent",
            ));
        };
        if name != MANIFEST_NAME {
            names.push(name.to_owned());
        }
    }
    names.sort();
    Ok(names)
}

/// Removes a finished change's directory, or reports what stopped it.
///
/// Never `remove_dir_all`. The directory is removed only once an enumeration has
/// *proved* it holds nothing but its own manifest, and then non-recursively, so
/// anything that arrives in the window between the two makes the kernel refuse
/// rather than lets the removal take it. Every error retains.
///
/// Takes the handle by value, so its drop lands at the one point it must — after
/// the enumeration, before the removal. Windows treats a handle still open on a
/// directory as a reason to hold its removal up rather than let it complete, so
/// a teardown keeping its own would be competing with itself; owning it settles
/// that here instead of leaving each caller to remember. The reopen that costs
/// is paid only where the removal has already failed.
///
/// `Err` carries what is still in there, for the report.
fn discard_operation_directory(
    root: &Dir,
    name: &str,
    directory: Dir,
    manifest: &Manifest,
) -> Result<(), Vec<String>> {
    let leftovers = staged_entry_names(&directory).map_err(|error| {
        vec![format!(
            "its contents could not be listed: {}",
            error.kind()
        )]
    })?;
    if !leftovers.is_empty() {
        return Err(leftovers);
    }
    if let Err(error) = fsx::remove_file(&directory, MANIFEST_NAME)
        && error.kind() != io::ErrorKind::NotFound
    {
        return Err(vec![format!(
            "its manifest could not be removed: {}",
            error.kind()
        )]);
    }

    // Everything that needs the handle has happened. It goes now, so the removal
    // below is not competing with its own caller for the directory.
    drop(directory);

    // Refuses if anything arrived after the listing above.
    let removed = rmdir_failure().map_or_else(|| fsx::remove_dir(root, name), Err);
    if let Err(error) = removed {
        // The manifest has already gone and the directory has not, so without
        // this the directory would survive with nothing describing what is in it
        // or what change put it there. The manifest is the only record of that,
        // so it goes back before the failure is reported — every caller gets this
        // rather than each having to remember it. The reopen is `nofollow`, so
        // no symlink is followed; a directory swapped in at the same name is out
        // of scope, because the vault lock keeps this tree to one process.
        let restored = root
            .open_dir_nofollow(name)
            .and_then(|reopened| write_manifest(&reopened, manifest));
        let mut reasons = vec![format!(
            "it could not be removed once empty: {}",
            error.kind()
        )];
        if let Err(error) = restored {
            reasons.push(format!(
                "and its manifest could not be written back: {}",
                error.kind()
            ));
        }
        return Err(reasons);
    }
    Ok(())
}

#[cfg(test)]
thread_local! {
    /// Makes the next operation-directory removal fail, so its consequences can
    /// be asserted.
    static FAIL_RMDIR: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Arms a simulated failure of the next operation-directory removal.
///
/// The window this opens — manifest gone, directory still there — cannot be
/// reached with permissions alone, because everything that would make `rmdir`
/// fail for real is caught by the enumeration above it.
#[cfg(test)]
fn fail_next_rmdir() {
    FAIL_RMDIR.with(|flag| flag.set(true));
}

#[cfg(test)]
fn rmdir_failure() -> Option<io::Error> {
    FAIL_RMDIR
        .with(|flag| flag.replace(false))
        .then(|| io::Error::other("simulated directory removal failure"))
}

#[cfg(not(test))]
const fn rmdir_failure() -> Option<io::Error> {
    None
}

fn staged_path(name: &str) -> String {
    format!(".bbb/{STAGING_DIRECTORY}/{name}")
}

/// Claims a directory name for one change.
///
/// `create_dir` is the claim, so two changes cannot take the same name even
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

    /// Holds `name`'s inode open, so its replacement cannot be handed the very
    /// number the test just recorded.
    ///
    /// The tests that replace an entry and expect a refusal are asserting about
    /// identity, and ext4 gives the next create the inode an unlink just freed —
    /// which is why they failed on Linux CI alone. The guard must outlive the
    /// create that follows. Test setup only; production identity is untouched.
    #[cfg(unix)]
    #[must_use]
    fn hold_identity(dir: &Dir, name: &str, kind: Kind) -> HeldIdentity {
        match kind {
            Kind::File => HeldIdentity::File {
                _handle: dir.open(name).expect("open the file being replaced"),
            },
            Kind::Directory => HeldIdentity::Directory {
                _handle: dir.open_dir_nofollow(name).expect("open the directory"),
            },
        }
    }

    /// The handle [`hold_identity`] keeps; being open is all it does.
    #[cfg(unix)]
    enum HeldIdentity {
        File { _handle: cap_std::fs::File },
        Directory { _handle: Dir },
    }

    /// Elsewhere an open handle would block the removal rather than outlive it,
    /// so there is nothing to hold and the call sites read the same.
    #[cfg(not(unix))]
    #[must_use]
    const fn hold_identity(_dir: &Dir, _name: &str, _kind: Kind) -> HeldIdentity {
        HeldIdentity
    }

    #[cfg(not(unix))]
    struct HeldIdentity;

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
    /// Installs a panic hook that silences simulated crashes and nothing else.
    ///
    /// The panic hook is process-global while `cargo test` runs these tests on
    /// several threads at once, so a `take_hook`/`set_hook`/restore around each
    /// simulated crash is a race: one test silences the hook while another
    /// panics for real and its message is lost, and two interleaved swaps can
    /// leave the silencing hook installed for the rest of the run. That is not
    /// hypothetical — it is why the CI failure this guards was reported with an
    /// empty `failures:` section and no panic text at all.
    ///
    /// So the hook is installed exactly once and never removed, and it decides
    /// per panic: a simulated crash is expected and stays quiet, anything else
    /// prints through the default hook.
    fn silence_simulated_crashes() {
        static ONCE: std::sync::Once = std::sync::Once::new();
        ONCE.call_once(|| {
            let default = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |info| {
                let payload = info.payload();
                let simulated = payload
                    .downcast_ref::<String>()
                    .map(String::as_str)
                    .or_else(|| payload.downcast_ref::<&str>().copied())
                    .is_some_and(|message| message.starts_with(SIMULATED_CRASH));
                if !simulated {
                    default(info);
                }
            }));
        });
    }

    fn crash_at(point: FaultPoint, body: impl FnOnce()) {
        silence_simulated_crashes();
        FAULT.with(|fault| fault.set(Some(point)));
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(body));
        FAULT.with(|fault| fault.set(None));

        // The *exact* payload, not merely "something panicked". A body that
        // panics for an unrelated reason also unwinds, and accepting that would
        // let a real bug masquerade as the simulated crash — every assertion
        // after this point would then be describing a state nobody intended.
        let panic = outcome.expect_err("the fault never tripped");
        let message = panic
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| panic.downcast_ref::<&str>().copied())
            .unwrap_or("<a panic payload that is not a string>");
        assert_eq!(
            message,
            format!("{SIMULATED_CRASH} {point:?}"),
            "the panic that unwound was not the simulated crash at {point:?}"
        );
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
                    let _held = hold_identity(&dev, "React--a1.md", Kind::File);
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
                    let _held = hold_identity(&dev, "React--a1.assets", Kind::Directory);
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
                let _held = hold_identity(&dev, "React--a1.md", Kind::File);
                fsx::remove_file(&dev, "React--a1.md").expect("remove");
                fsx::create_new(&dev, "React--a1.md", b"THEIRS").expect("replace");
            },
            || {
                let _ = staged.take(&origin, &dev_components(), "React--a1.md", false, expected);
            },
        );

        assert!(
            staged.manifest.actions.is_empty(),
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
                let _held = hold_identity(&dev, "React--a1.md", Kind::File);
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
            !staged.manifest.actions.is_empty(),
            "an entry stuck in staging must stay in the record, or nothing can find it"
        );
        let operation = staged.name.clone();
        // Dropped, not committed or rolled back: `Staged` has no `Drop`, so this
        // undoes nothing and leaves exactly what a crash would — except that the
        // handles close, which a leaked `Staged` would not do. The teardown this
        // test then requires to succeed must not be blocked by this process.
        drop(staged);

        // It is still there — never deleted — and recovery deals with it.
        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = fsx::open_dir(&root, &operation).expect("op dir");
        assert!(
            fsx::exists(&directory, "0-React--a1.md"),
            "the claimed entry must not be discarded"
        );
        drop(directory);

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
            fixture.staging_is_clear(),
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
                let _held = hold_identity(&dev, "React--a1.md", Kind::File);
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

    // -- an order file somebody else replaced ------------------------------

    /// The rule F2 exists for: a crash leaves the daemon's order file installed,
    /// somebody replaces it before the next start, and recovery must leave the
    /// replacement exactly where it is rather than restoring a backup over it.
    #[test]
    fn recovery_never_overwrites_an_order_file_it_did_not_install() {
        let fixture = fixture();
        fixture.seed_dev_order(FIRST);

        crash_at(FaultPoint::AfterStateWrite, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "set_order", "dev").expect("staging");
            fixture.write_dev_order(&mut staged, SECOND);
        });
        assert_eq!(fixture.dev_order().as_deref(), Some(SECOND));

        // Between the crash and the next start, another tool writes its own
        // order. It is now the user's current arrangement.
        let theirs = b"{\n  \"version\": 1,\n  \"children\": [],\n  \"theirs\": true\n}\n";
        fsx::write_replacing(&fixture.dev(), STATE_FILE_NAME, theirs).expect("replace");

        let retained = recover(&fixture.state, &fixture.vault);

        assert_eq!(
            fixture.dev_order().as_deref(),
            Some(&theirs[..]),
            "the replacement must survive untouched"
        );
        assert_eq!(retained.len(), 1, "{retained:?}");
        assert!(
            retained[0].reason.contains("rewritten since"),
            "and a person is told why: {}",
            retained[0].reason
        );
        assert!(
            retained[0]
                .entries
                .iter()
                .any(|line| line.contains("state-")),
            "with the order it replaced still named: {:?}",
            retained[0].entries
        );
    }

    /// The same rule where the change *created* the file: undoing means
    /// removing it, and removing somebody else's is exactly as bad.
    #[test]
    fn recovery_never_removes_an_order_file_it_did_not_install() {
        let fixture = fixture();
        assert!(fixture.dev_order().is_none());

        crash_at(FaultPoint::AfterStateWrite, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "dev").expect("staging");
            fixture.write_dev_order(&mut staged, FIRST);
        });

        let theirs = b"{\n  \"version\": 1,\n  \"children\": [],\n  \"theirs\": true\n}\n";
        fsx::write_replacing(&fixture.dev(), STATE_FILE_NAME, theirs).expect("replace");

        let retained = recover(&fixture.state, &fixture.vault);

        assert_eq!(
            fixture.dev_order().as_deref(),
            Some(&theirs[..]),
            "an order file this change did not install is never removed"
        );
        assert_eq!(retained.len(), 1, "{retained:?}");
    }

    /// Byte-identical is not the same as *the same file*: a replacement that
    /// happens to hold the same content is still somebody else's file, and the
    /// identity recorded alongside the digest is what tells them apart.
    #[cfg(any(unix, windows))]
    #[test]
    fn an_order_file_rewritten_to_identical_bytes_is_still_a_replacement() {
        let fixture = fixture();
        fixture.seed_dev_order(FIRST);

        crash_at(FaultPoint::AfterStateWrite, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "set_order", "dev").expect("staging");
            fixture.write_dev_order(&mut staged, SECOND);
        });

        // Same bytes, different file: removed and recreated, as a sync client
        // that replaces rather than patches would do.
        let dev = fixture.dev();
        let _held = hold_identity(&dev, STATE_FILE_NAME, Kind::File);
        fsx::remove_file(&dev, STATE_FILE_NAME).expect("remove");
        fsx::create_new(&dev, STATE_FILE_NAME, SECOND).expect("recreate");

        let retained = recover(&fixture.state, &fixture.vault);

        assert_eq!(
            fixture.dev_order().as_deref(),
            Some(SECOND),
            "the file that is there now is not one this change may touch"
        );
        assert_eq!(retained.len(), 1, "{retained:?}");
    }

    /// An order file somebody deleted is a different case: there is nothing of
    /// theirs to protect, and putting the previous order back is what was meant.
    #[test]
    fn an_order_file_that_vanished_is_restored_from_the_backup() {
        let fixture = fixture();
        fixture.seed_dev_order(FIRST);

        crash_at(FaultPoint::AfterStateWrite, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "set_order", "dev").expect("staging");
            fixture.write_dev_order(&mut staged, SECOND);
        });
        fsx::remove_file(&fixture.dev(), STATE_FILE_NAME).expect("remove");

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert_eq!(fixture.dev_order().as_deref(), Some(FIRST));
    }

    // -- created and relocated entries -------------------------------------

    /// Moves `React--a1.md` from `Dev` into `Other`, inside `staged`.
    fn relocate_react(fixture: &Fixture, staged: &mut Staged) -> io::Result<()> {
        let dev = fixture.dev();
        let other = fixture.vault.open_dir_nofollow("Other").expect("open");
        let dev_components = dev_components();
        let other_components = vec!["Other".to_owned()];
        staged.relocate(
            Place {
                dir: &dev,
                components: &dev_components,
                name: "React--a1.md",
            },
            Place {
                dir: &other,
                components: &other_components,
                name: "React--a1.md",
            },
            false,
        )
    }

    #[test]
    fn a_rollback_takes_a_created_entry_out_of_the_vault_and_keeps_it() {
        let fixture = fixture();
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
        staged
            .create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new")
            .expect("create");
        assert!(fixture.dev().symlink_metadata("New--n1.md").is_ok());

        // The vault is restored, so the caller's rollback succeeded; the kept
        // entry is reported through `bbb doctor`, not through this return value.
        staged.rollback().expect("rollback");

        assert!(
            fixture.dev().symlink_metadata("New--n1.md").is_err(),
            "an entry the caller was told did not happen must not be left in the vault"
        );
        let held = quarantined_names(&fixture.state);
        assert_eq!(held.len(), 1, "{held:?}");
        assert_eq!(
            fsx::read(&quarantine_dir(&fixture.state), &held[0]).expect("read"),
            b"new",
            "and it is kept, not destroyed"
        );
    }

    #[test]
    fn a_rollback_removes_a_created_directory_whose_contents_were_recorded() {
        let fixture = fixture();
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
        staged
            .create_directory(&fixture.dev(), &dev_components(), "New")
            .expect("create");
        let child = fsx::open_dir(&fixture.dev(), "New").expect("open");
        // Recorded, so the undo of the directory finds it already gone.
        staged
            .create_file(
                &child,
                &["Dev".to_owned(), "New".to_owned()],
                ".bbb-folder.md",
                b"meta",
            )
            .expect("metadata");
        drop(child);

        staged.rollback().expect("rollback");
        assert!(
            fixture.dev().symlink_metadata("New").is_err(),
            "a directory whose every child was recorded is emptied and removed"
        );
    }

    /// The adversarial half of the same rule, and the reason for it.
    ///
    /// A file inside a created directory that this change did not record could
    /// have been put there by anyone. `.bbb-folder.md` is not proof of authorship
    /// — it is just a name, and a name is trivially forged — so a directory
    /// holding one is handed back rather than deleted with its contents.
    #[test]
    fn a_rollback_quarantines_a_created_directory_with_everything_in_it() {
        let fixture = fixture();
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
        staged
            .create_directory(&fixture.dev(), &dev_components(), "New")
            .expect("create");
        let child = fsx::open_dir(&fixture.dev(), "New").expect("open");
        // Written straight to disk: this change has no record of it.
        fsx::create_new(&child, ".bbb-folder.md", b"NOT OURS").expect("metadata");
        drop(child);

        staged.rollback().expect("rollback");

        assert!(
            fixture.dev().symlink_metadata("New").is_err(),
            "the vault is restored"
        );
        // Nothing is inspected and nothing is deleted: the directory goes to
        // quarantine whole, with whatever a user had put inside it.
        let held = quarantined_names(&fixture.state);
        assert_eq!(held.len(), 1, "{held:?}");
        let kept = fsx::open_dir(&quarantine_dir(&fixture.state), &held[0]).expect("open");
        assert_eq!(
            fsx::read(&kept, ".bbb-folder.md").expect("read"),
            b"NOT OURS",
            "including a file whose name proves nothing about who wrote it"
        );
    }

    #[test]
    fn a_crash_before_a_create_leaves_nothing_behind() {
        let fixture = fixture();
        crash_at(FaultPoint::BeforeCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
            let _ = staged.create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new");
        });
        assert!(fixture.dev().symlink_metadata("New--n1.md").is_err());

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_crash_after_a_create_is_rolled_back() {
        let fixture = fixture();
        crash_at(FaultPoint::AfterCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
            let _ = staged.create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new");
        });
        assert!(
            fixture.dev().symlink_metadata("New--n1.md").is_ok(),
            "the entry did land, and the change never committed"
        );

        let retained = recover(&fixture.state, &fixture.vault);
        assert_eq!(retained.len(), 1, "{retained:?}");
        assert!(
            fixture.dev().symlink_metadata("New--n1.md").is_err(),
            "so recovery takes it out of the vault"
        );
        let held = quarantined_names(&fixture.state);
        assert_eq!(held.len(), 1, "{held:?}");
        assert_eq!(
            fsx::read(&quarantine_dir(&fixture.state), &held[0]).expect("read"),
            b"new",
            "and keeps it rather than deleting it"
        );
    }

    /// The create counterpart of F2: an entry replaced after the crash is not
    /// the entry the change made, and must not be removed.
    #[cfg(any(unix, windows))]
    #[test]
    fn recovery_never_removes_an_entry_it_did_not_create() {
        let fixture = fixture();
        crash_at(FaultPoint::AfterCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
            let _ = staged.create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new");
        });

        let dev = fixture.dev();
        let _held = hold_identity(&dev, "New--n1.md", Kind::File);
        fsx::remove_file(&dev, "New--n1.md").expect("remove");
        fsx::create_new(&dev, "New--n1.md", b"THEIRS").expect("replace");

        let retained = recover(&fixture.state, &fixture.vault);

        assert_eq!(
            fsx::read(&fixture.dev(), "New--n1.md").expect("read"),
            b"THEIRS",
            "somebody else's file at the same name must survive"
        );
        assert_eq!(retained.len(), 1, "{retained:?}");
        assert!(
            retained[0].reason.contains("no longer the entry"),
            "{}",
            retained[0].reason
        );
    }

    /// The same invariant as above, but for the case the filesystem creates
    /// rather than the user: a recycled inode number.
    ///
    /// `recovery_never_removes_an_entry_it_did_not_create` now pins the replaced
    /// file's inode, so the replacement cannot be handed the freed number — ext4
    /// hands it straight back, which is why that test failed on Linux CI alone.
    /// That makes it deterministic, but only for the case where the two numbers
    /// differ; it still proves nothing about a number that really was reused.
    ///
    /// This one removes the filesystem from the question. It rewrites the
    /// recorded number to the replacement's, which is exactly the state ext4
    /// produces, and then requires recovery to keep the file anyway — on every
    /// platform, deterministically.
    #[test]
    fn recovery_keeps_a_replacement_that_inherited_the_recorded_inode_number() {
        let fixture = fixture();
        crash_at(FaultPoint::AfterCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
            let _ = staged.create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new");
        });

        let dev = fixture.dev();
        let ours = identity_of(&dev, "New--n1.md", Kind::File).expect("our identity");
        fsx::remove_file(&dev, "New--n1.md").expect("remove");
        fsx::create_new(&dev, "New--n1.md", b"THEIRS").expect("replace");
        let theirs = identity_of(&dev, "New--n1.md", Kind::File).expect("their identity");

        assert!(
            ours.is_known() && theirs.is_known(),
            "this platform reports no file identity, so there is nothing to recycle"
        );

        // Forge the recycling: rewrite exactly one field of the parsed manifest,
        // the created entry's identity, and nothing else. A textual substitution
        // would also hit any other number that happened to share those digits,
        // and would have nothing to substitute at all on a filesystem that
        // really did recycle — which is the case this stands in for, so it must
        // not be the case that breaks it.
        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let operation = only_staging_directory(&root);
        let directory = root.open_dir_nofollow(&operation).expect("operation");
        forge_created_identity(&directory, theirs);
        assert_eq!(
            created_identity(&directory),
            theirs,
            "the manifest must name the replacement's identity, however the \
             filesystem happened to allocate it"
        );

        let retained = recover(&fixture.state, &fixture.vault);

        // Quarantined, not deleted. Identity plus content could never have told
        // this file apart from the one the change wrote, so recovery does not try:
        // it takes the entry out of the vault and keeps the bytes.
        assert_eq!(retained.len(), 1, "{retained:?}");
        let held = quarantined_names(&fixture.state);
        assert_eq!(held.len(), 1, "{held:?}");
        assert_eq!(
            fsx::read(&quarantine_dir(&fixture.state), &held[0]).expect("read"),
            b"THEIRS",
            "a recycled inode number must never cost somebody else's bytes"
        );
    }

    /// The race finding (1) is about, driven deterministically.
    ///
    /// The undo holds the file it claimed; the origin name is free while it
    /// decides. Something new arrives at that name in exactly that instant. An
    /// undo that verified a name and then removed that name would delete this
    /// newcomer — it looks identical from the outside. One that removes the
    /// object it claimed cannot reach it at all.
    #[test]
    fn a_file_arriving_at_the_name_during_an_undo_is_never_removed() {
        let fixture = fixture();
        crash_at(FaultPoint::AfterCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
            let _ = staged.create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new");
        });

        // The file the change created is still there and still its own bytes, so
        // the undo will legitimately decide to remove it.
        let vault = fixture.vault.try_clone().expect("clone vault");
        let retained = interpose_at_and_recover(&fixture, FaultPoint::AfterUndoClaim, move || {
            let dev = vault.open_dir_nofollow("Dev").expect("open Dev");
            // The name is free right now, because the entry is in staging.
            fsx::create_new(&dev, "New--n1.md", b"NEWCOMER").expect("take the free name");
        });

        assert_eq!(
            fsx::read(&fixture.dev(), "New--n1.md").expect("read"),
            b"NEWCOMER",
            "a file that arrived while the undo held its own entry must survive"
        );
        assert_eq!(retained.len(), 1, "{retained:?}");
        let held = quarantined_names(&fixture.state);
        assert_eq!(
            fsx::read(&quarantine_dir(&fixture.state), &held[0]).expect("read"),
            b"new",
            "and the undo's own entry is kept, not deleted, so neither file is lost"
        );
    }

    /// Substituting the *claim* must not turn into a deletion.
    ///
    /// Staging is the daemon's own directory, so this is a strong adversary — but
    /// the disposal is bound to the recorded identity rather than to the claim
    /// name, so a substitute is refused however it got there. The point is that
    /// nothing is destroyed on the strength of a name.
    #[test]
    fn a_substituted_file_claim_is_never_destroyed() {
        let fixture = fixture();
        crash_at(FaultPoint::AfterCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
            let _ = staged.create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new");
        });

        let state = fixture.state.try_clone().expect("clone state");
        let retained = interpose_at_and_recover(&fixture, FaultPoint::AfterUndoClaim, move || {
            // Swap the claim for a different file carrying the *same* bytes, so
            // only the identity gives it away.
            let root = fsx::open_or_create_dir(&state, STAGING_DIRECTORY).expect("root");
            let operation = only_staging_directory(&root);
            let directory = root.open_dir_nofollow(&operation).expect("operation");
            let claim = only_claim_name(&directory);
            let _held = hold_identity(&directory, &claim, Kind::File);
            fsx::remove_file(&directory, &claim).expect("take the claim away");
            fsx::create_new(&directory, &claim, b"new").expect("substitute");
        });

        // Nothing is inspected and nothing is unlinked, so a substituted claim
        // cannot become a deletion however it got there.
        assert_eq!(retained.len(), 1, "{retained:?}");
        let held = quarantined_names(&fixture.state);
        assert_eq!(held.len(), 1, "{held:?}");
        assert_eq!(
            fsx::read(&quarantine_dir(&fixture.state), &held[0]).expect("read"),
            b"new",
            "the substitute is still there, whole"
        );
    }

    /// The same, for a directory claim — the case that used to recurse.
    #[test]
    fn a_substituted_directory_claim_is_never_destroyed() {
        let fixture = fixture();
        crash_at(FaultPoint::AfterCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
            let _ = staged.create_directory(&fixture.dev(), &dev_components(), "New");
        });

        let state = fixture.state.try_clone().expect("clone state");
        let retained = interpose_at_and_recover(&fixture, FaultPoint::AfterUndoClaim, move || {
            let root = fsx::open_or_create_dir(&state, STAGING_DIRECTORY).expect("root");
            let operation = only_staging_directory(&root);
            let directory = root.open_dir_nofollow(&operation).expect("operation");
            let claim = only_claim_name(&directory);
            let _held = hold_identity(&directory, &claim, Kind::Directory);
            fsx::remove_dir(&directory, &claim).expect("take the claim away");
            fsx::create_dir(&directory, &claim).expect("substitute");
            let substitute = fsx::open_dir(&directory, &claim).expect("open substitute");
            fsx::create_new(&substitute, "theirs.md", b"THEIRS").expect("their file");
        });

        assert_eq!(retained.len(), 1, "{retained:?}");
        let held = quarantined_names(&fixture.state);
        assert_eq!(held.len(), 1, "{held:?}");
        let kept = fsx::open_dir(&quarantine_dir(&fixture.state), &held[0]).expect("open");
        assert_eq!(
            fsx::read(&kept, "theirs.md").expect("read"),
            b"THEIRS",
            "a substituted directory claim is never recursed into"
        );
    }

    /// Finding (3): a claim must survive the process that made it.
    ///
    /// Two actions, so the list is genuinely rewritten between passes and the
    /// claim name cannot be keyed on a position. The first pass claims the file —
    /// legitimately, the identity matches — and then dies while holding it. The
    /// user had edited the file in place, so it is *not* ours to delete.
    ///
    /// Without a durable record of the claim, the second pass finds the origin
    /// empty, calls the undo done, drops the action, empties the manifest, and
    /// deletes the operation directory — with the user's file inside it. With one,
    /// it resumes from the claim, sees the content does not match, and puts the
    /// file back.
    #[test]
    fn a_claim_held_across_a_crash_is_resumed_and_never_lost() {
        let fixture = fixture();
        crash_at(FaultPoint::AfterCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "two").expect("staging");
            let _ = staged.create_file(&fixture.dev(), &dev_components(), "One--n1.md", b"one");
            let _ = staged.create_file(&fixture.dev(), &dev_components(), "Two--n2.md", b"two");
        });

        // The user edits one of them in place: same inode, different bytes.
        let dev = fixture.dev();
        let before = identity_of(&dev, "One--n1.md", Kind::File).expect("identity before");
        edit_in_place(&dev, "One--n1.md", b"THE USER'S EDIT");

        // Pass one dies while holding whichever claim it took first.
        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            silence_simulated_crashes();
            interpose_at(
                FaultPoint::AfterUndoClaim,
                || panic!("{SIMULATED_CRASH} mid-undo"),
                || {
                    let _ = recover(&fixture.state, &fixture.vault);
                },
            );
        }));
        // The exact payload, for the same reason `crash_at` insists on it: any
        // other panic also unwinds, and accepting one would let a real bug pose
        // as the simulated crash while every later assertion described a state
        // nobody intended.
        let panic = outcome.expect_err("the simulated crash must have unwound");
        let message = panic
            .downcast_ref::<String>()
            .map(String::as_str)
            .or_else(|| panic.downcast_ref::<&str>().copied())
            .unwrap_or("<a panic payload that is not a string>");
        assert_eq!(message, format!("{SIMULATED_CRASH} mid-undo"));

        // Pass two, a fresh process in every respect that matters.
        let retained = recover(&fixture.state, &fixture.vault);

        // Resumed from the recorded claim rather than mistaken for "already
        // gone", so the user's edit is still on disk and still the same object.
        assert_eq!(retained.len(), 1, "{retained:?}");
        let quarantine = quarantine_dir(&fixture.state);
        let held = quarantined_names(&fixture.state);
        let kept = held
            .iter()
            .find(|name| {
                fsx::read(&quarantine, name).is_ok_and(|bytes| bytes == b"THE USER'S EDIT")
            })
            .expect("the edit must survive somewhere");
        assert!(
            fsx::file_identity(&quarantine, kept)
                .expect("identity after")
                .is_same(before),
            "and it is the same file, not a copy"
        );
    }

    /// Finding (1): a claim that landed is never reported as one that did not.
    ///
    /// The exchange path clears its placeholder from the origin *after* the entry
    /// has already moved into staging. If that cleanup fails, the entry is in
    /// staging and the manifest record is the only thing pointing at it. Calling
    /// that an ordinary I/O failure is how the record gets forgotten and the
    /// user's entry becomes unreachable to every later recovery pass.
    #[test]
    fn a_claim_stranded_by_its_own_cleanup_keeps_its_record() {
        let fixture = fixture();
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");
        let origin = fixture.dev();
        let expected = file_identity(&origin, "React--a1.md");

        fsx::fail_next_cleanup();
        let outcome = staged.take(&origin, &dev_components(), "React--a1.md", false, expected);

        match outcome {
            Err(TakeError::Orphaned(_)) => {}
            other => panic!("a stranded claim must be reported as orphaned, got {other:?}"),
        }
        assert!(
            !staged.manifest.actions.is_empty(),
            "and the record must survive, or nothing points at the entry any more"
        );

        // And what the kept record buys: recovery describes the entry instead of
        // losing it. It cannot put it back automatically — the placeholder this
        // call could not clear is still sitting on the origin name — so it says
        // so, and the entry stays in staging where a person can retrieve it. That
        // is the whole point: reported and intact beats tidy and gone.
        core::mem::forget(staged);
        let retained = recover(&fixture.state, &fixture.vault);
        assert_eq!(retained.len(), 1, "{retained:?}");
        assert!(
            retained[0]
                .entries
                .iter()
                .any(|entry| entry.contains("React--a1.md")),
            "{:?}",
            retained[0].entries
        );
        let root = fsx::open_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let operation = only_staging_directory(&root);
        let directory = root.open_dir_nofollow(&operation).expect("operation");
        assert_eq!(
            fsx::read(&directory, "0-React--a1.md").expect("still in staging"),
            b"bookmark",
            "the user's entry is intact and reachable, which is what the record is for"
        );
    }

    /// A teardown that removes the manifest and then cannot remove the directory
    /// must put the manifest back — on the commit path.
    ///
    /// That window is real: the manifest is unlinked first, so a failure after it
    /// leaves a directory nothing describes. Recovery already rewrote it as part
    /// of retaining; commit and rollback did not, so the operation's only record
    /// of what it was disappeared. The restore now lives in the teardown itself,
    /// which is why both paths get it.
    #[test]
    fn a_commit_whose_teardown_fails_puts_the_manifest_back() {
        let fixture = fixture();
        let staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");
        let operation = staged.name.clone();

        fail_next_rmdir();
        staged
            .commit()
            .expect("commit still succeeds; the change is committed");

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = root
            .open_dir_nofollow(&operation)
            .expect("the directory survived, as the failure intended");
        let manifest = read_manifest(&directory).expect("its manifest must have been put back");
        assert_eq!(
            manifest.operation, "delete_bookmark",
            "and it must still say what the change was"
        );
        assert!(
            matches!(manifest.phase, Phase::Committed),
            "and how far it got"
        );
    }

    /// The same window, on the rollback path.
    #[test]
    fn a_rollback_whose_teardown_fails_puts_the_manifest_back() {
        let fixture = fixture();
        let staged =
            Staged::open(&fixture.state, &fixture.vault, "set_order", "dev").expect("staging");
        let operation = staged.name.clone();

        fail_next_rmdir();
        staged.rollback().expect("rollback");

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = root
            .open_dir_nofollow(&operation)
            .expect("the directory survived");
        let manifest = read_manifest(&directory).expect("its manifest must have been put back");
        assert_eq!(manifest.operation, "set_order");
        assert!(matches!(manifest.phase, Phase::Staging));
    }

    /// The teardown takes the handle and restores the manifest through a
    /// reopened one, so recovery's retained flag has to be on the record it
    /// hands over. Set after the fact there would be no handle left to write it
    /// through, and the kept directory would carry no mark for `bbb doctor`.
    #[test]
    fn a_recovery_whose_teardown_fails_keeps_the_retained_flag() {
        let fixture = fixture();
        let staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");
        let operation = staged.name.clone();
        // Dropped rather than leaked, so the directory that survives below is
        // attributable to the injected `rmdir` failure and nothing else.
        drop(staged);

        fail_next_rmdir();
        let retained = recover(&fixture.state, &fixture.vault);

        assert_eq!(retained.len(), 1, "{retained:?}");
        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = root
            .open_dir_nofollow(&operation)
            .expect("the directory survived, as the failure intended");
        assert!(
            read_manifest(&directory)
                .expect("its manifest must have been put back")
                .retained,
            "and it must carry the flag, or nothing says it was kept"
        );
    }

    /// Finding (3): a commit never takes what `destroy` declined to touch.
    ///
    /// `destroy` refuses a staged entry it cannot identify. An unconditional
    /// recursive teardown afterwards would remove exactly that entry — so the
    /// commit shares recovery's teardown, which proves the directory empty first
    /// and keeps it otherwise.
    #[test]
    fn a_commit_keeps_a_staged_entry_it_could_not_identify() {
        let fixture = fixture();
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");
        let origin = fixture.dev();
        let expected = file_identity(&origin, "React--a1.md");
        staged
            .take(&origin, &dev_components(), "React--a1.md", false, expected)
            .expect("stage");
        let operation = staged.name.clone();

        // A record that cannot say what it staged, which is what an older
        // manifest looks like.
        if let Some(Action::Stage(entry)) = staged.manifest.actions.first_mut() {
            entry.identity = None;
        }

        staged.commit().expect("commit");

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = root
            .open_dir_nofollow(&operation)
            .expect("the directory must survive to hold what was kept");
        assert_eq!(
            fsx::read(&directory, "0-React--a1.md").expect("read"),
            b"bookmark",
            "an entry destroy declined to touch is never taken by the teardown"
        );
    }

    /// Finding (3): a directory that cannot be listed is never assumed empty.
    #[test]
    fn a_teardown_that_cannot_list_the_directory_retains_it() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        let operation = staged.name.clone();
        core::mem::forget(staged);

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = root.open_dir_nofollow(&operation).expect("operation");

        // An enumeration that fails must never read as "nothing is in here".
        let listed = staged_entry_names(&directory);
        assert!(listed.is_ok(), "the happy path still lists");
        let manifest = read_manifest(&directory).expect("manifest");
        let refused = discard_operation_directory(&root, &operation, directory, &manifest);
        assert!(
            refused.is_err(),
            "a directory still holding staged entries is never torn down"
        );
        assert!(
            root.open_dir_nofollow(&operation).is_ok(),
            "and it is still there"
        );
    }

    /// A staged entry no record accounts for is reported, never swept away.
    ///
    /// Uses a *staged* action, which undoes completely, so the manifest really is
    /// empty when the teardown runs — the one moment the operation directory
    /// would otherwise be removed. Anything sitting in it then has to survive.
    #[test]
    fn an_unaccounted_entry_in_staging_is_reported_rather_than_deleted() {
        let fixture = fixture();
        let staged = fixture.stage_both();
        let operation = staged.name.clone();
        core::mem::forget(staged);

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let directory = root.open_dir_nofollow(&operation).expect("operation");
        // Something nobody recorded, holding bytes that exist only here.
        fsx::create_new(&directory, "orphan.md", b"IRREPLACEABLE").expect("orphan");
        drop(directory);

        let retained = recover(&fixture.state, &fixture.vault);

        assert_eq!(retained.len(), 1, "{retained:?}");
        assert!(
            retained[0].reason.contains("no record accounts for"),
            "{}",
            retained[0].reason
        );
        let directory = root.open_dir_nofollow(&operation).expect("still there");
        assert_eq!(
            fsx::read(&directory, "orphan.md").expect("read"),
            b"IRREPLACEABLE",
            "an unaccounted entry is never deleted with the directory around it"
        );
        // This teardown refuses before it removes anything, so nothing rewrites
        // the manifest afterwards. The flag has to be on disk already, or
        // `bbb doctor` never mentions the directory it just kept.
        assert!(
            read_manifest(&directory).expect("manifest").retained,
            "a directory kept for a person must say so where doctor reads it"
        );
    }

    /// Rewrites a file's bytes without replacing the file.
    ///
    /// A rename-based write would give a new inode, and the point is a file whose
    /// identity still matches while its content does not.
    fn edit_in_place(dir: &Dir, name: &str, bytes: &[u8]) {
        use std::io::Write as _;

        let mut options = cap_std::fs::OpenOptions::new();
        options.write(true).truncate(true);
        let mut file = dir.open_with(name, &options).expect("open for writing");
        file.write_all(bytes).expect("write");
        file.sync_all().expect("sync");
    }

    /// The one claim a single interrupted create leaves in a staging directory.
    fn only_claim_name(directory: &Dir) -> String {
        let mut names: Vec<String> = directory
            .entries()
            .expect("entries")
            .flatten()
            .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
            .filter(|name| name.starts_with("undo-"))
            .collect();
        names.sort();
        assert_eq!(names.len(), 1, "{names:?}");
        names.remove(0)
    }

    /// Finding (3): recovery must not be talked into reading an arbitrary file.
    ///
    /// The identity is forged onto a replacement far larger than any document
    /// this project writes. Nothing about it can be ours, and establishing that
    /// must not require holding it in memory — so the size decides, the bytes are
    /// never read, and the entry is kept for a person.
    #[test]
    fn recovery_refuses_an_oversized_replacement_without_reading_it() {
        let fixture = fixture();
        crash_at(FaultPoint::AfterCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
            let _ = staged.create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new");
        });

        let dev = fixture.dev();
        fsx::remove_file(&dev, "New--n1.md").expect("remove ours");
        let oversized = vec![b'x'; usize::try_from(MAX_DOCUMENT_BYTES).expect("fits") + 1];
        fsx::create_new(&dev, "New--n1.md", &oversized).expect("their file");
        let theirs = identity_of(&dev, "New--n1.md", Kind::File).expect("their identity");

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let operation = only_staging_directory(&root);
        let directory = root.open_dir_nofollow(&operation).expect("operation");
        forge_created_identity(&directory, theirs);

        let retained = recover(&fixture.state, &fixture.vault);

        assert_eq!(retained.len(), 1, "{retained:?}");
        let held = quarantined_names(&fixture.state);
        assert_eq!(held.len(), 1, "{held:?}");
        assert_eq!(
            quarantine_dir(&fixture.state)
                .metadata(&held[0])
                .expect("the replacement must still exist")
                .len(),
            MAX_DOCUMENT_BYTES + 1,
            "an oversized replacement is moved whole and never read"
        );
    }

    /// Finding (2): a recycled directory number must not cost a tree.
    ///
    /// The recorded identity is forged onto a replacement directory that holds a
    /// user's file, which is exactly what an inode recycled to another directory
    /// looks like. The old behaviour was `remove_dir_all`, so the whole
    /// replacement went. Now the contents are inspected on the claimed object,
    /// found to be unaccountable, and the directory is handed back untouched.
    #[test]
    fn recovery_keeps_a_replacement_directory_that_inherited_the_recorded_inode_number() {
        let fixture = fixture();
        crash_at(FaultPoint::AfterCreate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
            let _ = staged.create_directory(&fixture.dev(), &dev_components(), "New");
        });

        let dev = fixture.dev();
        fsx::remove_dir_all(&dev, "New").expect("remove ours");
        // Somebody else's directory, with something in it worth losing.
        fsx::create_dir(&dev, "New").expect("their directory");
        let theirs_dir = fsx::open_dir(&dev, "New").expect("open theirs");
        fsx::create_new(&theirs_dir, "notes.md", b"THEIRS").expect("their file");
        fsx::create_dir(&theirs_dir, "deeper").expect("their subdirectory");
        let theirs = identity_of(&dev, "New", Kind::Directory).expect("their identity");
        assert!(theirs.is_known(), "no directory identity on this platform");

        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        let operation = only_staging_directory(&root);
        let directory = root.open_dir_nofollow(&operation).expect("operation");
        forge_created_identity(&directory, theirs);

        let retained = recover(&fixture.state, &fixture.vault);

        assert_eq!(retained.len(), 1, "{retained:?}");
        let held = quarantined_names(&fixture.state);
        assert_eq!(held.len(), 1, "{held:?}");
        let kept = fsx::open_dir(&quarantine_dir(&fixture.state), &held[0]).expect("open");
        assert_eq!(
            fsx::read(&kept, "notes.md").expect("read"),
            b"THEIRS",
            "a recycled directory number must never cost a tree"
        );
        assert!(
            fsx::open_dir(&kept, "deeper").is_ok(),
            "and everything below it comes along intact"
        );
    }

    /// Arms `point` for the duration of one recovery pass and returns its report.
    fn interpose_at_and_recover(
        fixture: &Fixture,
        point: FaultPoint,
        interposed: impl Fn() + 'static,
    ) -> Vec<Retained> {
        let mut retained = Vec::new();
        interpose_at(point, interposed, || {
            retained = recover(&fixture.state, &fixture.vault);
        });
        retained
    }

    /// Rewrites only `Created.identity` in the manifest on disk.
    ///
    /// Parsed and re-rendered rather than patched textually, so nothing else in
    /// the document can be caught by the edit.
    fn forge_created_identity(directory: &Dir, identity: FileIdentity) {
        let mut manifest: serde_json::Value =
            serde_json::from_slice(&fsx::read(directory, MANIFEST_NAME).expect("read manifest"))
                .expect("the manifest is JSON");
        let actions = manifest["actions"]
            .as_array_mut()
            .expect("the manifest has actions");
        let created = actions
            .iter_mut()
            .find(|action| action["action"] == "create")
            .expect("the manifest records a creation");
        created["identity"] = serde_json::to_value(identity).expect("identity is serialisable");

        let bytes = serde_json::to_vec(&manifest).expect("the manifest re-renders");
        let validated =
            fsx::read_with_identity(directory, MANIFEST_NAME).expect("validated manifest");
        fsx::replace_validated(directory, MANIFEST_NAME, &bytes, &validated)
            .expect("rewrite the manifest");
    }

    /// Reads back what the manifest now claims the created entry is.
    fn created_identity(directory: &Dir) -> FileIdentity {
        let manifest: serde_json::Value =
            serde_json::from_slice(&fsx::read(directory, MANIFEST_NAME).expect("read manifest"))
                .expect("the manifest is JSON");
        let created = manifest["actions"]
            .as_array()
            .expect("actions")
            .iter()
            .find(|action| action["action"] == "create")
            .expect("a creation");
        serde_json::from_value(created["identity"].clone()).expect("an identity")
    }

    /// Everything the change's manifest records as quarantined.
    fn quarantined_names(state: &Dir) -> Vec<String> {
        let Ok(root) = fsx::open_dir(state, STAGING_DIRECTORY) else {
            return Vec::new();
        };
        let Ok(entries) = root.entries() else {
            return Vec::new();
        };
        let mut held = Vec::new();
        for name in entries
            .flatten()
            .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
        {
            let Ok(directory) = root.open_dir_nofollow(&name) else {
                continue;
            };
            if let Ok(manifest) = read_manifest(&directory) {
                held.extend(manifest.quarantined.iter().map(|q| q.staged.clone()));
            }
        }
        held.sort();
        held
    }

    /// The directory holding the one interrupted change, for reading quarantine.
    fn quarantine_dir(state: &Dir) -> Dir {
        let root = fsx::open_dir(state, STAGING_DIRECTORY).expect("staging root");
        let operation = only_staging_directory(&root);
        root.open_dir_nofollow(&operation).expect("operation")
    }

    /// The one staging directory a single interrupted change leaves behind.
    fn only_staging_directory(root: &Dir) -> String {
        let mut names: Vec<String> = root
            .entries()
            .expect("staging entries")
            .flatten()
            .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
            .filter_map(|entry| entry.file_name().to_str().map(str::to_owned))
            .collect();
        names.sort();
        assert_eq!(names.len(), 1, "{names:?}");
        names.remove(0)
    }

    #[test]
    fn a_crash_after_a_relocation_puts_the_entry_back() {
        let fixture = fixture();
        fixture.vault.create_dir("Other").expect("create Other");

        crash_at(FaultPoint::AfterRelocate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "move", "a1").expect("staging");
            let _ = relocate_react(&fixture, &mut staged);
        });
        assert!(!fixture.bookmark_is_present(), "the entry did move");

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert!(fixture.bookmark_is_present(), "and is put back");
        assert_eq!(
            fsx::read(&fixture.dev(), "React--a1.md").expect("read"),
            b"bookmark"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_crash_before_a_relocation_leaves_the_entry_where_it_was() {
        let fixture = fixture();
        fixture.vault.create_dir("Other").expect("create Other");

        crash_at(FaultPoint::BeforeRelocate, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "move", "a1").expect("staging");
            let _ = relocate_react(&fixture, &mut staged);
        });
        assert!(fixture.bookmark_is_present());

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert!(fixture.bookmark_is_present());
    }

    /// A relocation and both order writes are one list, so a crash after the
    /// first order write undoes the rename as well.
    #[test]
    fn a_crash_between_a_relocation_and_its_order_writes_undoes_all_of_it() {
        let fixture = fixture();
        fixture.vault.create_dir("Other").expect("create Other");
        fixture.seed_dev_order(FIRST);
        let other = fixture.vault.open_dir_nofollow("Other").expect("open");
        fsx::create_new(&other, STATE_FILE_NAME, FIRST).expect("seed other");
        drop(other);

        crash_at(FaultPoint::AfterStateWrite, || {
            let mut staged =
                Staged::open(&fixture.state, &fixture.vault, "move", "a1").expect("staging");
            relocate_react(&fixture, &mut staged).expect("relocate");
            let other = fixture.vault.open_dir_nofollow("Other").expect("open");
            let current = fsx::read_with_identity(&other, STATE_FILE_NAME).ok();
            staged
                .write_state(&other, &["Other".to_owned()], SECOND, current.as_ref())
                .expect("destination order");
        });

        let retained = recover(&fixture.state, &fixture.vault);
        assert!(retained.is_empty(), "{retained:?}");
        assert!(
            fixture.bookmark_is_present(),
            "the entry goes back where it was"
        );
        let other = fixture.vault.open_dir_nofollow("Other").expect("open");
        assert_eq!(
            fsx::read(&other, STATE_FILE_NAME).expect("read").as_slice(),
            FIRST,
            "and so does the order that had already been written"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_committed_change_keeps_what_it_created_and_moved() {
        let fixture = fixture();
        fixture.vault.create_dir("Other").expect("create Other");

        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
        staged
            .create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new")
            .expect("create");
        relocate_react(&fixture, &mut staged).expect("relocate");
        staged.commit().expect("commit");
        let other = fixture.vault.open_dir_nofollow("Other").expect("open");

        assert_eq!(
            fsx::read(&fixture.dev(), "New--n1.md").expect("read"),
            b"new",
            "a committed create is the change's result, not something to clean up"
        );
        assert!(!fixture.bookmark_is_present());
        assert_eq!(
            fsx::read(&other, "React--a1.md").expect("read"),
            b"bookmark"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_manifest_from_the_unreleased_version_3_is_never_acted_on() {
        let fixture = fixture();
        let root = fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("root");
        fsx::create_dir(&root, "op-0").expect("op dir");
        let directory = fsx::open_dir(&root, "op-0").expect("open op");
        fsx::create_new(
            &directory,
            MANIFEST_NAME,
            br#"{"version":3,"operation":"delete_bookmark","phase":"staging","entries":[
               {"origin":["Dev"],"name":"React--a1.md","staged":"0-x","kind":"file"}]}"#,
        )
        .expect("manifest");
        fsx::create_new(&directory, "0-x", b"staged bytes").expect("staged entry");

        let retained = recover(&fixture.state, &fixture.vault);

        assert_eq!(retained.len(), 1, "{retained:?}");
        assert!(
            fsx::exists(&directory, "0-x"),
            "a shape this build cannot read is kept, never guessed at"
        );
    }

    #[test]
    fn a_manifest_with_a_hostile_action_is_never_acted_on() {
        for (label, body) in [
            (
                "escaping create origin",
                r#"{"version":4,"operation":"create","phase":"staging","actions":[
                   {"action":"create","origin":["..",".."],"name":"passwd","kind":"file",
                    "identity":{"known":{"volume":1,"number":2}}}]}"#,
            ),
            (
                "escaping relocate destination",
                r#"{"version":4,"operation":"move","phase":"staging","actions":[
                   {"action":"relocate","from":[],"from_name":"a.md","to":["../.."],
                    "to_name":"passwd","kind":"file",
                    "identity":{"known":{"volume":1,"number":2}}}]}"#,
            ),
            (
                "escaping order origin",
                r#"{"version":4,"operation":"set_order","phase":"staging","actions":[
                   {"action":"order","origin":["..",".."],"backup":"state-0.json",
                    "installed":{"revision":"00","identity":{"unavailable":null}}}]}"#,
            ),
            (
                "state directory as an order origin",
                r#"{"version":4,"operation":"set_order","phase":"staging","actions":[
                   {"action":"order","origin":[".bbb"],"backup":"state-0.json",
                    "installed":{"revision":"00","identity":{"unavailable":null}}}]}"#,
            ),
        ] {
            let fixture = fixture();
            let root =
                fsx::open_or_create_dir(&fixture.state, STAGING_DIRECTORY).expect("staging root");
            fsx::create_dir(&root, "op-0").expect("op dir");
            let directory = fsx::open_dir(&root, "op-0").expect("open op");
            fsx::create_new(&directory, MANIFEST_NAME, body.as_bytes()).expect("manifest");
            fsx::create_new(&directory, "state-0.json", b"staged bytes").expect("backup");

            let retained = recover(&fixture.state, &fixture.vault);

            assert_eq!(retained.len(), 1, "{label}: {retained:?}");
            assert!(
                fixture.bookmark_is_present(),
                "{label}: nothing in the vault may be touched"
            );
            assert!(
                fixture.vault.symlink_metadata("passwd").is_err(),
                "{label}: nothing may be created from a hostile record"
            );
        }
    }
}
