//! Reversible deletion.
//!
//! A multi-file operation that deletes as it goes cannot be undone: once the
//! third file is gone, a failure on the fourth leaves a vault the daemon can
//! neither complete nor restore. So nothing is deleted in place. Entries are
//! *renamed* into `<vault>/.bbb/staging/<id>/`, which is one atomic operation
//! per entry on the same filesystem, and only once every entry has moved is the
//! staging directory destroyed.
//!
//! That gives two properties worth the machinery:
//!
//! * **Rollback.** A failure part-way renames every staged entry back where it
//!   came from, and the vault is exactly as it was.
//! * **Crash safety.** A crash between the last rename and the cleanup leaves
//!   the entries in `.bbb/staging`, outside the vault's content. The next
//!   daemon to take the lock purges it. The vault is never half-deleted; at
//!   worst some bytes wait in a directory the scanner ignores.
//!
//! Recovery runs while the vault lock is held, so anything found in staging is
//! provably the residue of a run that is no longer alive.

use std::io;

use cap_fs_ext::DirExt as _;
use cap_std::fs::Dir;

use crate::fsx;

/// The staging directory's name inside the daemon's state directory.
pub(crate) const STAGING_DIRECTORY: &str = "staging";

/// A set of entries moved out of the vault, pending destruction.
///
/// Dropping a `Staged` without calling [`Staged::commit`] or
/// [`Staged::rollback`] leaves the entries in staging, where the next start-up
/// purge will find them. That is a safe default: the vault has already lost
/// them, and losing them is what was asked for.
#[derive(Debug)]
pub(crate) struct Staged {
    /// The `.bbb/staging/<id>` handle everything was renamed into.
    directory: Dir,
    /// The state directory, so the staging directory itself can be removed.
    state: Dir,
    /// The staging directory's name inside `.bbb/staging`.
    name: String,
    /// How to put each entry back, newest first.
    restores: Vec<Restore>,
}

#[derive(Debug)]
struct Restore {
    /// The name the entry has while staged.
    staged: String,
    /// The directory it came from.
    origin: Dir,
    /// The name it had there.
    original: String,
    /// Whether it is a directory, which decides which move is used to restore.
    is_directory: bool,
}

impl Staged {
    /// Opens a fresh staging area under `state`.
    ///
    /// # Errors
    ///
    /// Returns any I/O error from creating the directories.
    pub(crate) fn open(state: &Dir, id: &str) -> io::Result<Self> {
        let root = fsx::open_or_create_dir(state, STAGING_DIRECTORY)?;
        let name = id.to_owned();
        root.create_dir(&name)?;
        let directory = root.open_dir_nofollow(&name)?;
        Ok(Self {
            directory,
            state: root,
            name,
            restores: Vec::new(),
        })
    }

    /// Moves `name` out of `origin` and into staging.
    ///
    /// # Errors
    ///
    /// Returns any I/O error from the rename. The caller should
    /// [`Staged::rollback`] on failure; entries already staged are still
    /// restorable.
    pub(crate) fn take(&mut self, origin: &Dir, name: &str, is_directory: bool) -> io::Result<()> {
        // Staged names are positional, so two entries with the same name from
        // different directories cannot collide with each other.
        let staged = format!("{}-{}", self.restores.len(), sanitize(name));

        if is_directory {
            fsx::move_dir(origin, name, &self.directory, &staged)?;
        } else {
            fsx::move_file(origin, name, &self.directory, &staged)?;
        }

        self.restores.push(Restore {
            staged,
            origin: origin.try_clone()?,
            original: name.to_owned(),
            is_directory,
        });
        Ok(())
    }

    /// Destroys everything that was staged.
    ///
    /// # Errors
    ///
    /// Returns an I/O error only when the staging directory itself cannot be
    /// removed. By this point the vault no longer references the entries, so a
    /// failure here leaves bytes for the next start-up purge rather than an
    /// inconsistent vault.
    pub(crate) fn commit(self) -> io::Result<()> {
        drop(self.directory);
        self.state.remove_dir_all(&self.name)
    }

    /// Puts every staged entry back where it came from.
    ///
    /// Restores run newest-first so that a directory staged before its former
    /// contents is put back before them.
    ///
    /// # Errors
    ///
    /// Returns the first restore failure, having attempted every entry. An
    /// entry that cannot be restored stays in staging and is reported, so the
    /// state is always one of "fully restored" or "named in an error".
    pub(crate) fn rollback(mut self) -> io::Result<()> {
        let mut failure = None;
        while let Some(restore) = self.restores.pop() {
            let outcome = if restore.is_directory {
                fsx::move_dir(
                    &self.directory,
                    &restore.staged,
                    &restore.origin,
                    &restore.original,
                )
            } else {
                fsx::move_file(
                    &self.directory,
                    &restore.staged,
                    &restore.origin,
                    &restore.original,
                )
            };
            if let Err(error) = outcome
                && failure.is_none()
            {
                failure = Some(error);
            }
        }

        drop(self.directory);
        let _ = self.state.remove_dir_all(&self.name);
        match failure {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

/// Removes everything left in staging by a previous run.
///
/// Only ever called while the vault lock is held, so any leftovers belong to a
/// process that is gone. A failure is not fatal: stale staging costs disk
/// space, and refusing to start over it would turn a crash into an outage.
pub(crate) fn purge(state: &Dir) {
    if state.symlink_metadata(STAGING_DIRECTORY).is_err() {
        // Nothing was left behind, which is the ordinary case.
        return;
    }
    if let Err(error) = state.remove_dir_all(STAGING_DIRECTORY) {
        tracing::warn!(
            error = %error.kind(),
            "the staging directory left by a previous run could not be removed"
        );
    } else {
        tracing::info!("removed the staging directory left by a previous run");
    }
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

    fn vault() -> (tempfile::TempDir, Dir, Dir) {
        let directory = tempfile::tempdir().expect("temp dir");
        let root = fsx::open_root(directory.path()).expect("open root");
        let state = fsx::open_or_create_dir(&root, ".bbb").expect("state dir");
        (directory, root, state)
    }

    #[test]
    fn a_rollback_puts_every_entry_back() {
        let (_temp, root, state) = vault();
        fsx::create_new(&root, "one.md", b"one").expect("create");
        fsx::create_new(&root, "two.md", b"two").expect("create");
        root.create_dir("folder").expect("create dir");
        let folder = root.open_dir_nofollow("folder").expect("open");
        fsx::create_new(&folder, "three.md", b"three").expect("create");
        drop(folder);

        let mut staged = Staged::open(&state, "op").expect("open staging");
        staged.take(&root, "one.md", false).expect("stage one");
        staged.take(&root, "two.md", false).expect("stage two");
        staged.take(&root, "folder", true).expect("stage folder");

        assert!(
            fsx::read(&root, "one.md").is_err(),
            "staged out of the vault"
        );

        staged.rollback().expect("rollback");

        assert_eq!(fsx::read(&root, "one.md").expect("read"), b"one");
        assert_eq!(fsx::read(&root, "two.md").expect("read"), b"two");
        let folder = root.open_dir_nofollow("folder").expect("folder is back");
        assert_eq!(fsx::read(&folder, "three.md").expect("read"), b"three");
    }

    #[test]
    fn a_commit_destroys_everything_staged() {
        let (_temp, root, state) = vault();
        fsx::create_new(&root, "one.md", b"one").expect("create");

        let mut staged = Staged::open(&state, "op").expect("open staging");
        staged.take(&root, "one.md", false).expect("stage");
        staged.commit().expect("commit");

        assert!(fsx::read(&root, "one.md").is_err(), "the entry is gone");
        assert!(
            state.open_dir_nofollow(STAGING_DIRECTORY).is_ok(),
            "the staging root remains for reuse"
        );
        let remaining: Vec<_> = state
            .open_dir_nofollow(STAGING_DIRECTORY)
            .expect("open staging")
            .entries()
            .expect("entries")
            .collect();
        assert!(remaining.is_empty(), "no staged operation is left behind");
    }

    #[test]
    fn entries_with_the_same_name_do_not_collide_in_staging() {
        let (_temp, root, state) = vault();
        root.create_dir("a").expect("create a");
        root.create_dir("b").expect("create b");
        let a = root.open_dir_nofollow("a").expect("open a");
        let b = root.open_dir_nofollow("b").expect("open b");
        fsx::create_new(&a, "same.md", b"from a").expect("create");
        fsx::create_new(&b, "same.md", b"from b").expect("create");

        let mut staged = Staged::open(&state, "op").expect("open staging");
        staged.take(&a, "same.md", false).expect("stage a");
        staged.take(&b, "same.md", false).expect("stage b");
        staged.rollback().expect("rollback");

        assert_eq!(fsx::read(&a, "same.md").expect("read"), b"from a");
        assert_eq!(fsx::read(&b, "same.md").expect("read"), b"from b");
    }

    #[test]
    fn a_purge_clears_what_a_crashed_run_left() {
        let (_temp, root, state) = vault();
        fsx::create_new(&root, "one.md", b"one").expect("create");
        let mut staged = Staged::open(&state, "op").expect("open staging");
        staged.take(&root, "one.md", false).expect("stage");
        // Dropped without commit or rollback: exactly what a crash leaves.
        drop(staged);
        assert!(state.open_dir_nofollow(STAGING_DIRECTORY).is_ok());

        purge(&state);
        assert!(
            state.symlink_metadata(STAGING_DIRECTORY).is_err(),
            "the staging directory is gone after a purge"
        );
    }
}
