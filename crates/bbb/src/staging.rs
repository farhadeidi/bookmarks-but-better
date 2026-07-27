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

use bbb_vault_core::STATE_FILE_NAME;

use crate::fsx::{self, FileIdentity, component};

/// The staging directory's name inside the daemon's state directory.
pub(crate) const STAGING_DIRECTORY: &str = "staging";
/// The manifest's name inside one change's directory.
const MANIFEST_NAME: &str = "manifest.json";
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
    /// crash window the record exists to make harmless. Present is also what
    /// proves later that the thing at that name is still the thing this change
    /// made, rather than something a user put there afterwards.
    #[serde(default)]
    identity: Option<FileIdentity>,
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
    fn is_empty(&self) -> bool {
        self.actions.is_empty()
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
                let orphaned = matches!(error, fsx::ClaimError::UndoFailed { .. });
                if !orphaned {
                    self.forget();
                }
                Err(match error {
                    fsx::ClaimError::NotTheSameEntry => TakeError::NotTheSameEntry,
                    fsx::ClaimError::Io(error) => TakeError::Io(error),
                    fsx::ClaimError::UndoFailed { cause, .. } => TakeError::Orphaned(cause),
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
        self.record(Action::Create(Created {
            origin: origin_components.to_vec(),
            name: name.to_owned(),
            kind,
            identity: None,
        }))
    }

    /// Records what the new entry turned out to be, so an undo can recognise it.
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
        drop(self.directory);
        let _ = self.root.remove_dir_all(&self.name);
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
            drop(self.directory);
            let _ = self.root.remove_dir_all(&self.name);
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
fn identity_of(dir: &Dir, name: &str, kind: Kind) -> io::Result<FileIdentity> {
    match kind {
        Kind::Directory => fsx::directory_identity(&fsx::open_dir(dir, name)?),
        Kind::File => Ok(fsx::read_with_identity(dir, name)?.identity),
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
                entries: manifest.actions.iter().map(Action::describe).collect(),
                reason: outcome.err().map_or_else(
                    || "they could not be restored".to_owned(),
                    |error| error.to_string(),
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
    let mut kept = Vec::new();

    for action in manifest.actions.iter().rev() {
        if let Err(error) = undo_one(directory, vault, action) {
            failure.get_or_insert(error);
            kept.push(action.clone());
        }
    }

    kept.reverse();
    manifest.actions = kept;
    match failure {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

fn undo_one(directory: &Dir, vault: &Dir, action: &Action) -> io::Result<()> {
    // Validated at the point of use: this is reachable from recovery, whose
    // manifest came off disk, and from rollback, whose did not.
    action
        .validate()
        .map_err(|reason| io::Error::new(io::ErrorKind::InvalidInput, reason))?;

    match action {
        Action::Stage(entry) => undo_stage(directory, vault, entry),
        Action::Create(created) => undo_create(vault, created),
        Action::Relocate(moved) => undo_relocate(vault, moved),
        Action::Order(order) => undo_order(directory, vault, order),
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

/// Removes an entry the change created — but only if it is still that entry.
fn undo_create(vault: &Dir, created: &Created) -> io::Result<()> {
    let Some(identity) = created.identity else {
        // Recorded and never created.
        return Ok(());
    };
    let origin = fsx::open_components(vault, &created.origin)?;
    let current = match identity_of(&origin, &created.name, created.kind) {
        Ok(current) => current,
        // Already gone, which is the outcome that was wanted.
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    if !identity.is_known() || !current.is_same(identity) {
        return Err(replaced(&format!(
            "`{}` in {} is no longer the entry this change created, so it was left alone",
            created.name,
            display(&created.origin)
        )));
    }
    match created.kind {
        Kind::Directory => fsx::remove_dir_all(&origin, &created.name),
        Kind::File => fsx::remove_file(&origin, &created.name),
    }
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
        // Recorded and never written.
        return Ok(());
    };

    let folder = fsx::open_components(vault, &order.origin)?;
    match fsx::read_with_identity(&folder, STATE_FILE_NAME) {
        Ok(current) if installed.still_installed(&current) => {}
        Ok(_) => {
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
            let bytes = fsx::read(directory, backup)?;
            return fsx::write_replacing(&folder, STATE_FILE_NAME, &bytes);
        }
        Err(error) => return Err(error),
    }

    match &order.backup {
        Some(backup) => {
            let bytes = fsx::read(directory, backup)?;
            fsx::write_replacing(&folder, STATE_FILE_NAME, &bytes)
        }
        // The folder had no order file, so this change created it and undoing
        // means it should have none again.
        None => fsx::remove_file(&folder, STATE_FILE_NAME),
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
            Action::Stage(entry) => match entry.kind {
                Kind::Directory => fsx::remove_dir_all(directory, &entry.staged),
                Kind::File => fsx::remove_file(directory, &entry.staged),
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
    let bytes = fsx::read(directory, MANIFEST_NAME)
        .map_err(|error| format!("its manifest could not be read: {}", error.kind()))?;
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
    fn a_rollback_removes_an_entry_the_change_created() {
        let fixture = fixture();
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
        staged
            .create_file(&fixture.dev(), &dev_components(), "New--n1.md", b"new")
            .expect("create");
        assert!(fixture.dev().symlink_metadata("New--n1.md").is_ok());

        staged.rollback().expect("rollback");

        assert!(
            fixture.dev().symlink_metadata("New--n1.md").is_err(),
            "an entry the caller was told did not happen must not be left behind"
        );
        assert!(fixture.staging_is_clear());
    }

    #[test]
    fn a_rollback_removes_a_directory_the_change_created_and_everything_in_it() {
        let fixture = fixture();
        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "create", "new").expect("staging");
        staged
            .create_directory(&fixture.dev(), &dev_components(), "New")
            .expect("create");
        let child = fsx::open_dir(&fixture.dev(), "New").expect("open");
        fsx::create_new(&child, ".bbb-folder.md", b"meta").expect("metadata");
        drop(child);

        staged.rollback().expect("rollback");
        assert!(fixture.dev().symlink_metadata("New").is_err());
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
        assert!(retained.is_empty(), "{retained:?}");
        assert!(
            fixture.dev().symlink_metadata("New--n1.md").is_err(),
            "so recovery removes it"
        );
        assert!(fixture.staging_is_clear());
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
