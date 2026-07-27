//! Reversible deletion, and recovery from an interrupted one.
//!
//! A multi-file operation that deletes as it goes cannot be undone: once the
//! third file is gone, a failure on the fourth leaves a vault the daemon can
//! neither complete nor restore. So nothing is deleted in place. Entries are
//! *renamed* into `<vault>/.bbb/staging/<id>/`, one atomic operation per entry
//! on the same filesystem, and only once every entry has moved are they
//! destroyed.
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
//! Recovery runs while the vault lock is held, so anything it finds is provably
//! the residue of a run that is no longer alive.

use std::io;

use cap_fs_ext::DirExt as _;
use cap_std::fs::Dir;
use serde::{Deserialize, Serialize};

use crate::fsx;

/// The staging directory's name inside the daemon's state directory.
pub(crate) const STAGING_DIRECTORY: &str = "staging";
/// The manifest's name inside one operation's directory.
const MANIFEST_NAME: &str = "manifest.json";
/// Where retained entries are explained, in the staging root.
const RECOVERY_NAME: &str = "recovery.txt";
/// The manifest format this build writes and understands.
const MANIFEST_VERSION: u32 = 1;

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
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Entry {
    /// The vault-relative directory it came from; empty means the root.
    origin: String,
    /// The name it had there.
    name: String,
    /// The name it has while staged.
    staged: String,
    /// Whether it is a file or a directory.
    kind: Kind,
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
    /// Every entry it moved, or was about to move.
    entries: Vec<Entry>,
}

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
}

#[cfg(test)]
thread_local! {
    static FAULT: std::cell::Cell<Option<FaultPoint>> = const { std::cell::Cell::new(None) };
}

#[cfg(test)]
fn trip(point: FaultPoint) {
    let armed = FAULT.with(std::cell::Cell::get);
    assert!(armed != Some(point), "simulated crash at {point:?}");
}

#[cfg(not(test))]
const fn trip(_point: FaultPoint) {}

/// A set of entries moved out of the vault, pending destruction.
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
            entries: Vec::new(),
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
        origin_relative: &str,
        name: &str,
        is_directory: bool,
    ) -> io::Result<()> {
        // Staged names are positional, so two entries with the same name from
        // different directories cannot collide with each other.
        let staged = format!("{}-{}", self.manifest.entries.len(), sanitize(name));
        self.manifest.entries.push(Entry {
            origin: origin_relative.to_owned(),
            name: name.to_owned(),
            staged: staged.clone(),
            kind: if is_directory {
                Kind::Directory
            } else {
                Kind::File
            },
        });
        // Recorded before the move, so a crash can never orphan the entry.
        write_manifest(&self.directory, &self.manifest)?;

        if self.manifest.entries.len() == 1 {
            trip(FaultPoint::BeforeFirstRename);
        } else {
            trip(FaultPoint::BetweenRenames);
        }

        let moved = if is_directory {
            fsx::move_dir(origin, name, &self.directory, &staged)
        } else {
            fsx::move_file(origin, name, &self.directory, &staged)
        };
        if let Err(error) = moved {
            // The record describes a move that did not happen. Recovery copes
            // with that, but the manifest should not keep claiming it.
            self.manifest.entries.pop();
            let _ = write_manifest(&self.directory, &self.manifest);
            return Err(error);
        }
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

    /// Puts every staged entry back where it came from.
    ///
    /// Restores run newest-first, so a directory staged before its former
    /// contents is put back before them.
    ///
    /// # Errors
    ///
    /// Returns the first restore failure, having attempted every entry.
    /// Anything that could not be restored stays in staging with its manifest
    /// intact, so recovery and `bbb doctor` can still describe it.
    pub(crate) fn rollback(mut self) -> io::Result<()> {
        let outcome = restore_all(&self.directory, &self.vault, &mut self.manifest);
        let _ = write_manifest(&self.directory, &self.manifest);

        if self.manifest.entries.is_empty() {
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
            let outcome = restore_all(&directory, vault, &mut manifest);
            let _ = write_manifest(&directory, &manifest);
            if manifest.entries.is_empty() {
                drop(directory);
                let _ = root.remove_dir_all(name);
                tracing::info!(
                    operation = %manifest.operation,
                    "rolled back a change interrupted before it committed"
                );
                return None;
            }
            Some(Retained {
                directory: staged_path(name),
                operation: manifest.operation.clone(),
                entries: manifest.entries.iter().map(describe).collect(),
                reason: outcome.err().map_or_else(
                    || "they could not be restored".to_owned(),
                    |error| error.kind().to_string(),
                ),
            })
        }
        Phase::Committed => {
            destroy(&directory, &manifest);
            let leftovers = staged_entry_names(&directory);
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

/// Moves every entry back, dropping from `manifest` those that made it.
///
/// An entry whose staged file is absent was recorded but never moved — the
/// manifest is written first on purpose — and counts as restored.
fn restore_all(directory: &Dir, vault: &Dir, manifest: &mut Manifest) -> io::Result<()> {
    let mut failure = None;
    let mut kept = Vec::new();

    for entry in manifest.entries.iter().rev() {
        if let Err(error) = restore_one(directory, vault, entry) {
            if failure.is_none() {
                failure = Some(error);
            }
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

fn restore_one(directory: &Dir, vault: &Dir, entry: &Entry) -> io::Result<()> {
    if directory.symlink_metadata(&entry.staged).is_err() {
        // Recorded but never moved; there is nothing to put back.
        return Ok(());
    }
    let origin = fsx::open_relative_dir(vault, &entry.origin)?;
    match entry.kind {
        Kind::Directory => fsx::move_dir(directory, &entry.staged, &origin, &entry.name),
        Kind::File => fsx::move_file(directory, &entry.staged, &origin, &entry.name),
    }
}

/// Removes every staged entry the manifest names.
fn destroy(directory: &Dir, manifest: &Manifest) {
    for (index, entry) in manifest.entries.iter().enumerate() {
        if index > 0 {
            trip(FaultPoint::MidDestroy);
        }
        let removed = match entry.kind {
            Kind::Directory => directory.remove_dir_all(&entry.staged),
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
                fsx::CommitError::Stale => io::Error::new(
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
    if manifest.version != MANIFEST_VERSION {
        return Err(format!(
            "its manifest is version {}, which this build does not understand",
            manifest.version
        ));
    }
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
    let origin = if entry.origin.is_empty() {
        "the vault root".to_owned()
    } else {
        entry.origin.clone()
    };
    format!("{} belongs in {origin} as {}", entry.staged, entry.name)
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
            staged
                .take(&origin, "Dev", "React--a1.md", false)
                .expect("stage bookmark");
            staged
                .take(&origin, "Dev", "React--a1.assets", true)
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

    #[test]
    fn entries_with_the_same_name_do_not_collide_in_staging() {
        let fixture = fixture();
        fixture.vault.create_dir("Other").expect("create Other");
        let other = fixture.vault.open_dir_nofollow("Other").expect("open");
        fsx::create_new(&other, "React--a1.md", b"other").expect("create");

        let mut staged =
            Staged::open(&fixture.state, &fixture.vault, "delete_bookmark", "a1").expect("staging");
        staged
            .take(&fixture.dev(), "Dev", "React--a1.md", false)
            .expect("stage one");
        staged
            .take(&other, "Other", "React--a1.md", false)
            .expect("stage two");
        staged.rollback().expect("rollback");

        assert_eq!(
            fsx::read(&fixture.dev(), "React--a1.md").expect("read"),
            b"bookmark"
        );
        assert_eq!(fsx::read(&other, "React--a1.md").expect("read"), b"other");
    }
}
