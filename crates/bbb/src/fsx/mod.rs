//! Every filesystem operation the daemon performs, resolved through directory
//! handles rather than through paths.
//!
//! # Why handles
//!
//! A path is resolved by the kernel at the moment it is used, so any check made
//! against a path describes a filesystem that may no longer exist by the time
//! the operation runs. `is_file(p)` followed by `open(p)` is two resolutions of
//! one name, and in between it can become a symbolic link pointing anywhere the
//! daemon has permission to write. On a directory the user syncs with
//! third-party tools that is not a theoretical race.
//!
//! So no name is ever resolved twice here. A directory handle is opened once
//! with the no-follow flag ([`cap_std`], which is `openat`/`O_NOFOLLOW` on Unix
//! and the reparse-point equivalent on Windows), and every child is resolved
//! against that handle. The handle that was checked is the handle that is used.
//! This is the same model [`bbb_vault_core::scan`] already walks the vault with.
//!
//! # Why replacement is a module and not a call
//!
//! Durably replacing a file is four steps, and each platform supports a
//! different subset of them. Keeping the sequence in one place is what stops
//! three call sites from each getting a different part of it wrong.
//!
//! # Binding a commit to what was validated
//!
//! Optimistic concurrency reads a file, decides its revision is current, and
//! writes. Between those two moments the name can come to mean a different
//! file, and a rename onto the *name* would then destroy an edit nobody
//! examined. [`replace_validated`] closes that:
//!
//! * Where the kernel offers an atomic exchange (Linux), the new file is
//!   swapped with the target in one operation and the evicted file is read
//!   afterwards. If it is not the bytes that were validated, the swap is undone
//!   and the caller is told the revision is stale. Nothing is ever lost,
//!   because the exchange only ever moved two entries that both still exist.
//! * Elsewhere the target is re-opened no-follow immediately before the rename
//!   and its identity *and* contents are compared with what was validated. The
//!   remaining window is one syscall wide and is documented rather than denied.

use std::io::{self, Read as _, Write as _};
use std::path::{Component, Path};

use bbb_vault_core::Revision;
use cap_fs_ext::{DirExt as _, FollowSymlinks, OpenOptionsFollowExt as _};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};

pub(crate) mod component;
mod ident;
pub(crate) mod platform;

pub(crate) use ident::FileIdentity;

#[cfg(test)]
thread_local! {
    /// Makes the next undo fail, so its consequences can be asserted.
    static FAIL_UNDO: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// Arms a simulated failure of the next undo on this thread.
///
/// An undo failing is the one path that leaves the user's bytes somewhere
/// other than where they belong, and it cannot be provoked with permissions
/// alone, so it is switched on directly.
#[cfg(test)]
pub(crate) fn fail_next_undo() {
    FAIL_UNDO.with(|flag| flag.set(true));
}

#[cfg(test)]
fn undo_failure() -> Option<io::Error> {
    FAIL_UNDO
        .with(|flag| flag.replace(false))
        .then(|| io::Error::other("simulated undo failure"))
}

#[cfg(not(test))]
const fn undo_failure() -> Option<io::Error> {
    None
}

/// Rejects anything that is not one plain, portable path component.
///
/// Every primitive below calls this on every name it is given, rather than
/// trusting its caller to have done so. A precondition checked only at the
/// boundary is a precondition the next call site forgets.
fn guard(name: &str) -> io::Result<()> {
    component::check(name).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("`{name}` is not a usable name: {error}"),
        )
    })
}

/// The identity of an open directory, for binding an operation to it.
///
/// # Errors
///
/// Returns the underlying I/O error from inspecting the handle.
pub(crate) fn directory_identity(dir: &Dir) -> io::Result<FileIdentity> {
    ident::of_dir(dir)
}

/// How many times a unique temporary name is retried before giving up.
///
/// Each attempt uses a different counter value and `create_new`, so a collision
/// means another writer took that exact name in between. Sixty-four losses in a
/// row is not contention, it is a broken directory.
const TEMP_NAME_ATTEMPTS: u32 = 64;

/// Opens a vault root, refusing a root that is itself a link.
///
/// This mirrors [`bbb_vault_core::scan`]'s refusal exactly, and for the same
/// reason: a vault must be a directory the user chose, not an indirection into
/// one. The final component is resolved against its parent's handle with
/// no-follow, so there is no window between deciding the root is a real
/// directory and opening it.
///
/// # Errors
///
/// Returns the underlying I/O error, including a refusal when the root is a
/// symbolic link or a Windows reparse point.
pub(crate) fn open_root(root: &Path) -> io::Result<Dir> {
    let authority = ambient_authority();

    let Some(Component::Normal(name)) = root.components().next_back() else {
        // A filesystem root, or a path ending in `.` or `..`: there is no
        // directory entry anyone could substitute a link for.
        return Dir::open_ambient_dir(root, authority);
    };

    let parent = match root.parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent,
        _ => Path::new("."),
    };

    Dir::open_ambient_dir(parent, authority)?
        .open_dir_nofollow(name)
        .map_err(|error| {
            io::Error::new(
                error.kind(),
                format!(
                    "the vault root {} could not be opened as a real directory \
                     (symbolic links and reparse points are refused): {error}",
                    root.display()
                ),
            )
        })
}

/// Opens a vault-relative directory, refusing to traverse any link.
///
/// `relative` is the `/`-separated form the scanner produces; an empty string
/// means the root itself. Each component is resolved against the previous
/// handle, so a link substituted at any depth fails here rather than escaping.
///
/// # Errors
///
/// Returns the I/O error of the first component that cannot be opened as a real
/// directory, and [`io::ErrorKind::InvalidInput`] for a component that is not a
/// plain name.
pub(crate) fn open_relative_dir(root: &Dir, relative: &str) -> io::Result<Dir> {
    let components = component::split(relative).map_err(|(part, error)| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("`{part}` is not a usable path component: {error}"),
        )
    })?;
    open_components(root, &components)
}

/// Opens a directory by walking already-validated components, one handle at a
/// time.
///
/// This is the only way a path from a manifest is ever resolved. Each component
/// is opened against the previous handle with no-follow, so the result is
/// beneath `root` by construction rather than by a check on a joined string.
///
/// # Errors
///
/// Returns the I/O error of the first component that cannot be opened, and
/// [`io::ErrorKind::InvalidInput`] for a component that is not a plain name.
pub(crate) fn open_components(root: &Dir, components: &[String]) -> io::Result<Dir> {
    let mut current = root.try_clone()?;
    for name in components {
        guard(name)?;
        current = current.open_dir_nofollow(name.as_str())?;
    }
    Ok(current)
}

/// Reads a file through `dir`, never following a link at the final component.
///
/// # Errors
///
/// Returns the underlying I/O error; a symlink at `name` fails rather than
/// being read through.
pub(crate) fn read(dir: &Dir, name: &str) -> io::Result<Vec<u8>> {
    guard(name)?;
    let mut file = dir.open_with(name, &read_options())?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(bytes)
}

/// Creates `name` with `bytes`, failing if anything already holds that name.
///
/// `create_new` is what makes this collision-safe: the check and the claim are
/// one atomic operation, so two writers racing for a name cannot both win, and
/// an existing symlink is refused rather than written through.
///
/// # Errors
///
/// Returns [`io::ErrorKind::AlreadyExists`] when the name is taken, and any
/// other I/O error from the write or the sync.
pub(crate) fn create_new(dir: &Dir, name: &str, bytes: &[u8]) -> io::Result<()> {
    guard(name)?;
    let mut file = dir.open_with(name, &create_new_options())?;
    file.write_all(bytes)?;
    file.sync_all()?;
    sync_dir(dir);
    Ok(())
}

/// A file read together with the identity of the object it came from.
#[derive(Debug)]
pub(crate) struct Validated {
    /// The exact bytes read.
    pub(crate) bytes: Vec<u8>,
    /// What the operating system calls the file those bytes came from.
    pub(crate) identity: FileIdentity,
}

impl Validated {
    /// The revision of the bytes that were read.
    pub(crate) fn revision(&self) -> Revision {
        Revision::of(&self.bytes)
    }
}

/// Reads a file and its identity from one open handle.
///
/// Both facts come from the same `open`, so they describe the same object;
/// reading the bytes and then stat-ing the name would be two resolutions and
/// could describe two different files.
///
/// # Errors
///
/// Returns the underlying I/O error.
pub(crate) fn read_with_identity(dir: &Dir, name: &str) -> io::Result<Validated> {
    guard(name)?;
    let mut file = dir.open_with(name, &read_options())?;
    let identity = ident::of(&file)?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(Validated { bytes, identity })
}

/// Why a validated commit did not happen.
#[derive(Debug)]
pub(crate) enum CommitError {
    /// The file is no longer the one that was validated.
    Stale,
    /// The operation failed for an ordinary I/O reason.
    Io(io::Error),
    /// A swap could not be undone, so the user's bytes are at `temporary`.
    ///
    /// The temporary must not be removed: after a successful exchange it holds
    /// the file that was evicted from the destination, which is the user's only
    /// copy. The caller is responsible for rescuing it.
    UndoFailed {
        /// The name, in the same directory, now holding the user's bytes.
        temporary: String,
        /// Why the undo failed.
        cause: io::Error,
    },
}

impl From<io::Error> for CommitError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Durably replaces `name` with `bytes`, but only if it still holds `validated`.
///
/// The sequence, and why each step is there:
///
/// 1. Write to a uniquely named temporary file **in the same directory**, so
///    the final step is a rename within one filesystem and can be atomic. The
///    name is claimed with `create_new` through the directory handle, so it can
///    neither collide with a concurrent writer nor be pre-created as a symlink.
/// 2. `fsync` the temporary file, so its contents reach the disk before any
///    name points at them. Without this a crash can leave `name` pointing at a
///    file of zeroes.
/// 3. Commit, bound to `validated` — see the module documentation. On Linux an
///    atomic exchange followed by a check of what was evicted; elsewhere a
///    re-open, an identity and content comparison, and a rename.
/// 4. `fsync` the directory, so the rename itself survives a power loss. Unix
///    only: Windows has no portable equivalent, and instead the rename itself
///    is issued with `MOVEFILE_WRITE_THROUGH`.
///
/// # Errors
///
/// Returns [`CommitError::Stale`] when the file changed since it was validated,
/// leaving that change intact, and [`CommitError::Io`] for anything else. On
/// either failure the destination keeps its current bytes and the temporary
/// file is removed.
pub(crate) fn replace_validated(
    dir: &Dir,
    name: &str,
    bytes: &[u8],
    validated: &Validated,
) -> Result<(), CommitError> {
    // The name and the open handle come back together. Claiming a name and
    // then reopening it by that name would be two resolutions of one string —
    // exactly the pattern this module exists to avoid.
    let (temporary, mut file) = create_temp(dir, name)?;

    let write = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = write {
        let _ = remove_file(dir, &temporary);
        return Err(CommitError::Io(error));
    }

    match commit(dir, &temporary, name, validated) {
        Ok(()) => {}
        // The temporary still holds only the bytes this call produced, so
        // removing it loses nothing.
        Err(error @ (CommitError::Stale | CommitError::Io(_))) => {
            let _ = remove_file(dir, &temporary);
            return Err(error);
        }
        // A failed undo means the temporary holds the *user's* evicted file.
        // Deleting it here would destroy the very thing the undo was trying to
        // save, so it is left exactly where it is and named to the caller.
        Err(CommitError::UndoFailed { cause, .. }) => {
            return Err(CommitError::UndoFailed { temporary, cause });
        }
    }

    sync_dir(dir);
    Ok(())
}

/// Puts the temporary file in place of `name`, refusing if it changed.
fn commit(
    dir: &Dir,
    temporary: &str,
    name: &str,
    validated: &Validated,
) -> Result<(), CommitError> {
    if platform::exchange_is_supported() {
        // One atomic step: after it, `temporary` names whatever `name` named.
        platform::exchange(dir, temporary, dir, name)?;

        let evicted = match read_with_identity(dir, temporary) {
            Ok(evicted) => evicted,
            Err(error) => {
                // The swap happened but the result cannot be read. Undo it, so
                // the vault is left exactly as it was found.
                let _ = platform::exchange(dir, temporary, dir, name);
                return Err(CommitError::Io(error));
            }
        };

        if evicted.revision() != validated.revision()
            || (validated.identity.is_known() && !evicted.identity.is_same(validated.identity))
        {
            // Somebody replaced the file between validation and now. Put their
            // version back and refuse; they lose nothing.
            let undo =
                undo_failure().map_or_else(|| platform::exchange(dir, temporary, dir, name), Err);
            if let Err(cause) = undo {
                return Err(CommitError::UndoFailed {
                    temporary: temporary.to_owned(),
                    cause,
                });
            }
            return Err(CommitError::Stale);
        }

        // The swap is confirmed, so the temporary name now holds the superseded
        // file. It is the old content, and removing it is what completes the
        // replacement — the non-exchange path below gets this for free, because
        // there the rename consumes the temporary.
        remove_file(dir, temporary)?;
        return Ok(());
    }

    // No exchange here. Re-open the target and compare identity and content
    // immediately before the rename, so the gap is one syscall rather than the
    // whole request.
    let current = read_with_identity(dir, name)?;
    if current.revision() != validated.revision()
        || (validated.identity.is_known() && !current.identity.is_same(validated.identity))
    {
        return Err(CommitError::Stale);
    }
    platform::rename_replacing(dir, temporary, dir, name)?;
    Ok(())
}

/// Durably writes `bytes` to `name`, whether or not it is already there.
///
/// This is deliberately *not* bound to a previously validated file, and it has
/// exactly one caller: undoing a write this process made moments ago, where
/// what is currently at the name is our own output and putting the original
/// back is the whole point. Every write that lands on a file the user could
/// have touched goes through [`replace_validated`] instead.
///
/// # Errors
///
/// Returns the underlying I/O error.
pub(crate) fn write_replacing(dir: &Dir, name: &str, bytes: &[u8]) -> io::Result<()> {
    guard(name)?;
    let Ok(current) = read_with_identity(dir, name) else {
        return create_new(dir, name, bytes);
    };
    replace_validated(dir, name, bytes, &current).map_err(|error| match error {
        CommitError::Io(error) | CommitError::UndoFailed { cause: error, .. } => error,
        CommitError::Stale => io::Error::new(
            io::ErrorKind::AlreadyExists,
            "the file changed while it was being put back",
        ),
    })
}

/// Removes a file or link through `dir`, never following it.
///
/// # Errors
///
/// Returns the underlying I/O error.
pub(crate) fn remove_file(dir: &Dir, name: &str) -> io::Result<()> {
    guard(name)?;
    dir.remove_file_or_symlink(name)
}

/// Removes a directory and everything in it, through `dir`.
///
/// # Errors
///
/// Returns the underlying I/O error.
pub(crate) fn remove_dir_all(dir: &Dir, name: &str) -> io::Result<()> {
    guard(name)?;
    dir.remove_dir_all(name)
}

/// Creates an empty directory, failing if the name is taken.
///
/// # Errors
///
/// Returns [`io::ErrorKind::AlreadyExists`] when the name is taken.
pub(crate) fn create_dir(dir: &Dir, name: &str) -> io::Result<()> {
    guard(name)?;
    dir.create_dir(name)
}

/// Opens a child directory, refusing to follow a link.
///
/// # Errors
///
/// Returns the underlying I/O error.
pub(crate) fn open_dir(dir: &Dir, name: &str) -> io::Result<Dir> {
    guard(name)?;
    dir.open_dir_nofollow(name)
}

/// Whether `name` exists in `dir`, judged without following links.
pub(crate) fn exists(dir: &Dir, name: &str) -> bool {
    guard(name).is_ok() && dir.symlink_metadata(name).is_ok()
}

/// Creates a uniquely named temporary file in `dir` and returns it, open.
///
/// The name is derived from the destination so a crash leaves something
/// obviously related to it, and is prefixed with a dot so the leftover is
/// something the scanner already ignores rather than a stray Markdown file that
/// would surface as a bookmark.
///
/// `create_new` is what makes the name unique: each attempt claims the name
/// atomically, so `AlreadyExists` means some other writer holds it and the next
/// counter value is tried. The caller receives the handle, not just the name,
/// so the file it writes to is provably the file that was claimed.
fn create_temp(dir: &Dir, destination: &str) -> io::Result<(String, cap_std::fs::File)> {
    let stem: String = destination
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || *character == '-')
        .take(32)
        .collect();

    for attempt in 0..TEMP_NAME_ATTEMPTS {
        let candidate = format!(".{stem}.{attempt}.bbb-tmp");
        match dir.open_with(&candidate, &create_new_options()) {
            Ok(file) => return Ok((candidate, file)),
            // The name was claimed between attempts; the next counter value
            // is a different name, so simply fall through to it.
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "no temporary name was free in the destination directory",
    ))
}

/// Moves a file between directory handles without ever replacing anything.
///
/// A plain rename silently destroys whatever is already at the destination, so
/// the name is claimed first with `create_new` — an atomic operation that
/// cannot be lost to a race — and the rename then replaces nothing but that
/// placeholder, which this call owns. If the rename fails the placeholder is
/// removed, leaving both directories as they were.
///
/// # Errors
///
/// Returns [`io::ErrorKind::AlreadyExists`] when the destination name is taken,
/// and any other I/O error from the rename.
pub(crate) fn move_file(from: &Dir, from_name: &str, to: &Dir, to_name: &str) -> io::Result<()> {
    guard(from_name)?;
    guard(to_name)?;
    // Claiming the name is the whole point: between this and the rename, no
    // other writer can take it, because it is already taken by us.
    let placeholder = to.open_with(to_name, &create_new_options())?;
    drop(placeholder);

    if let Err(error) = platform::rename_replacing(from, from_name, to, to_name) {
        let _ = to.remove_file(to_name);
        return Err(error);
    }

    sync_dir(from);
    sync_dir(to);
    Ok(())
}

/// Why a verified claim did not happen.
#[derive(Debug)]
pub(crate) enum ClaimError {
    /// The entry is not the one the caller verified; it has been left alone.
    NotTheSameEntry,
    /// The operation failed for an ordinary I/O reason.
    Io(io::Error),
    /// The claim landed but could not be undone, so the destination holds the
    /// entry and the caller must keep it.
    UndoFailed {
        /// Why the undo failed.
        cause: io::Error,
    },
}

impl From<io::Error> for ClaimError {
    fn from(error: io::Error) -> Self {
        Self::Io(error)
    }
}

/// Moves `name` out of `from` into `to`, but only if it is still `expected`.
///
/// This is the delete-side counterpart of [`replace_validated`], and it closes
/// the same window. Checking the identity and then renaming leaves a gap in
/// which the entry can be replaced, and the rename would then carry away
/// somebody else's file or directory.
///
/// Where the platform has an atomic exchange, a placeholder is created at the
/// destination and swapped with the entry: the origin name is never empty, so
/// nothing can be created there while the swap is examined, and if the wrong
/// thing was taken the swap is reversed and the replacement is untouched.
///
/// Elsewhere the entry is claimed with a no-replace rename and then examined;
/// the wrong thing is renamed straight back. The origin name is briefly absent
/// there, which is the one difference between the two paths.
///
/// # Errors
///
/// [`ClaimError::NotTheSameEntry`] when the entry was replaced,
/// [`ClaimError::UndoFailed`] when it was claimed and could not be given back,
/// and [`ClaimError::Io`] for anything else.
pub(crate) fn claim_verified(
    from: &Dir,
    from_name: &str,
    to: &Dir,
    to_name: &str,
    is_directory: bool,
    expected: FileIdentity,
) -> Result<(), ClaimError> {
    guard(from_name)?;
    guard(to_name)?;

    if platform::exchange_is_supported() {
        // Build the placeholder first, so the swap has something to put back
        // into the origin and that name is never momentarily free.
        if is_directory {
            create_dir(to, to_name)?;
        } else {
            drop(to.open_with(to_name, &create_new_options())?);
        }
        // Remembered so it can be recognised later. After the swap it sits at
        // the origin name, and if the undo fails it has to be cleared out of
        // the way — but only once it is known to still be ours.
        let placeholder = claim_identity(to, to_name, is_directory)?;

        if let Err(error) = platform::exchange(from, from_name, to, to_name) {
            let _ = remove_claim(to, to_name, is_directory);
            return Err(ClaimError::Io(error));
        }

        return match verify_claim(to, to_name, is_directory, expected) {
            Ok(()) => {
                // The placeholder is now sitting at the origin name; removing
                // it completes the move.
                remove_claim(from, from_name, is_directory)?;
                Ok(())
            }
            Err(mismatch) => {
                // Swap back: the entry returns to its name and the placeholder
                // comes back here to be discarded.
                let undo = undo_failure()
                    .map_or_else(|| platform::exchange(from, from_name, to, to_name), Err);
                if let Err(cause) = undo {
                    // The entry stays here, and our placeholder is stranded on
                    // the origin name. Clearing it frees that name so recovery
                    // can put the entry back — but only if it is provably still
                    // the placeholder this call created, never if something
                    // else has taken the name since.
                    if claim_identity(from, from_name, is_directory)
                        .is_ok_and(|current| current.is_same(placeholder))
                    {
                        let _ = remove_claim(from, from_name, is_directory);
                    }
                    return Err(ClaimError::UndoFailed { cause });
                }
                let _ = remove_claim(to, to_name, is_directory);
                Err(mismatch)
            }
        };
    }

    // No exchange here: claim the entry outright, then give it back if it turns
    // out to be the wrong one.
    if is_directory {
        move_dir(from, from_name, to, to_name)?;
    } else {
        move_file(from, from_name, to, to_name)?;
    }

    match verify_claim(to, to_name, is_directory, expected) {
        Ok(()) => Ok(()),
        Err(mismatch) => {
            let undo = undo_failure().map_or_else(
                || {
                    if is_directory {
                        move_dir(to, to_name, from, from_name)
                    } else {
                        move_file(to, to_name, from, from_name)
                    }
                },
                Err,
            );
            match undo {
                Ok(()) => Err(mismatch),
                Err(cause) => Err(ClaimError::UndoFailed { cause }),
            }
        }
    }
}

/// The identity of whatever sits at `name`, file or directory.
fn claim_identity(dir: &Dir, name: &str, is_directory: bool) -> io::Result<FileIdentity> {
    if is_directory {
        directory_identity(&open_dir(dir, name)?)
    } else {
        Ok(read_with_identity(dir, name)?.identity)
    }
}

/// Checks that what now sits at `name` is the entry that was expected.
fn verify_claim(
    dir: &Dir,
    name: &str,
    is_directory: bool,
    expected: FileIdentity,
) -> Result<(), ClaimError> {
    let actual = claim_identity(dir, name, is_directory)?;

    // An identity the platform cannot supply is not evidence of a match. The
    // caller has already compared content where it can; claiming success on
    // `Unavailable == Unavailable` would be inventing a guarantee.
    if expected.is_known() && actual.is_same(expected) {
        Ok(())
    } else {
        Err(ClaimError::NotTheSameEntry)
    }
}

fn remove_claim(dir: &Dir, name: &str, is_directory: bool) -> io::Result<()> {
    if is_directory {
        remove_dir_all(dir, name)
    } else {
        remove_file(dir, name)
    }
}

/// Moves a directory between handles without ever replacing anything.
///
/// Each platform uses its own no-replace rename: `renameat2(RENAME_NOREPLACE)`
/// on Linux, `renameatx_np(RENAME_EXCL)` on macOS, `MoveFileExW` without
/// `MOVEFILE_REPLACE_EXISTING` on Windows. Each makes the kernel refuse rather
/// than clobber, so there is no window at all.
///
/// A platform with none of those refuses the move with
/// [`io::ErrorKind::Unsupported`]. Probing the destination and renaming anyway
/// would look like it worked and would occasionally destroy a directory, which
/// is worse than not offering the feature.
///
/// # Errors
///
/// Returns [`io::ErrorKind::AlreadyExists`] when the destination name is taken,
/// [`io::ErrorKind::Unsupported`] where there is no such primitive, and any
/// other I/O error from the rename.
pub(crate) fn move_dir(from: &Dir, from_name: &str, to: &Dir, to_name: &str) -> io::Result<()> {
    guard(from_name)?;
    guard(to_name)?;
    platform::rename_no_replace(from, from_name, to, to_name)?;
    sync_dir(from);
    sync_dir(to);
    Ok(())
}

/// Opens `name` as a real directory, creating it if it is absent.
///
/// A name that exists but is a symlink, a reparse point or a file is refused:
/// the daemon's own state directory must be a directory it created, not
/// something pointed at whatever an attacker chose.
///
/// # Errors
///
/// Returns the underlying I/O error, including the refusal above.
/// Opens the daemon's own state directory, without creating it.
///
/// `.bbb` is the one name [`component::check`] refuses, because no vault
/// content may resolve into it — so the daemon needs an explicit door of its
/// own rather than a hole in the check.
///
/// # Errors
///
/// Returns the underlying I/O error, including a refusal when `.bbb` exists but
/// is a link or a reparse point.
pub(crate) fn open_state_dir(root: &Dir) -> io::Result<Dir> {
    root.open_dir_nofollow(component::STATE_DIRECTORY)
}

pub(crate) fn open_or_create_dir(dir: &Dir, name: &str) -> io::Result<Dir> {
    // The daemon's own state directory is the one name vault content may not
    // use, so it is created here through the unguarded call deliberately; every
    // other name goes through `guard`.
    if name != component::STATE_DIRECTORY {
        guard(name)?;
    }
    match dir.create_dir(name) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    dir.open_dir_nofollow(name).map_err(|error| {
        io::Error::new(
            error.kind(),
            format!(
                "`{name}` exists but is not a real directory (symbolic links and reparse points \
                 are refused): {error}"
            ),
        )
    })
}

/// Flushes a directory entry change to disk where the platform supports it.
///
/// Opening a directory and syncing it is a Unix idiom. Windows has no portable
/// equivalent, so the call is compiled out there rather than failing at runtime
/// and being ignored — the difference is visible in the code, not buried in a
/// discarded `Result`.
#[cfg(unix)]
pub(crate) fn sync_dir(dir: &Dir) {
    if let Ok(clone) = dir.try_clone() {
        let _ = clone.into_std_file().sync_all();
    }
}

#[cfg(not(unix))]
pub(crate) fn sync_dir(_dir: &Dir) {}

fn read_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    options.read(true).follow(FollowSymlinks::No);
    options
}

fn create_new_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    options
        .write(true)
        .create_new(true)
        .follow(FollowSymlinks::No);
    options
}

/// Options for a handle that may be locked: readable, writable, never followed.
pub(crate) fn lock_file_options() -> OpenOptions {
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .follow(FollowSymlinks::No);
    options
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Replaces `name` after validating whatever is currently there.
    ///
    /// Tests that are not about the concurrency protocol use this so they read
    /// as "overwrite this file"; the protocol itself is tested separately.
    fn replace(dir: &Dir, name: &str, bytes: &[u8]) -> io::Result<()> {
        let validated = read_with_identity(dir, name)?;
        replace_validated(dir, name, bytes, &validated).map_err(|error| match error {
            CommitError::Io(error) => error,
            CommitError::Stale => io::Error::other("the file changed during the test"),
            CommitError::UndoFailed { cause, .. } => cause,
        })
    }

    fn temp_root() -> (tempfile::TempDir, Dir) {
        let directory = tempfile::tempdir().expect("temp dir");
        let handle = open_root(directory.path()).expect("open root");
        (directory, handle)
    }

    #[test]
    fn replace_overwrites_and_leaves_no_temporary_behind() {
        let (directory, root) = temp_root();
        create_new(&root, "note.md", b"first").expect("create");
        replace(&root, "note.md", b"second").expect("replace");

        assert_eq!(read(&root, "note.md").expect("read"), b"second");
        let names: Vec<String> = std::fs::read_dir(directory.path())
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .collect();
        assert_eq!(names, vec!["note.md".to_owned()]);
    }

    #[test]
    fn create_new_refuses_a_taken_name() {
        let (_directory, root) = temp_root();
        create_new(&root, "note.md", b"first").expect("create");
        let error = create_new(&root, "note.md", b"second").expect_err("must refuse");
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(read(&root, "note.md").expect("read"), b"first");
    }

    #[test]
    fn move_file_never_replaces_an_existing_entry() {
        let (_directory, root) = temp_root();
        root.create_dir("dst").expect("create dir");
        let destination = root.open_dir_nofollow("dst").expect("open dst");
        create_new(&root, "note.md", b"source").expect("create source");
        create_new(&destination, "note.md", b"victim").expect("create victim");

        let error = move_file(&root, "note.md", &destination, "note.md").expect_err("must refuse");
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            read(&destination, "note.md").expect("read"),
            b"victim",
            "the entry that was already there must survive"
        );
        assert_eq!(read(&root, "note.md").expect("read"), b"source");
    }

    #[test]
    fn move_file_moves_when_the_name_is_free() {
        let (_directory, root) = temp_root();
        root.create_dir("dst").expect("create dir");
        let destination = root.open_dir_nofollow("dst").expect("open dst");
        create_new(&root, "note.md", b"source").expect("create source");

        move_file(&root, "note.md", &destination, "note.md").expect("move");
        assert_eq!(read(&destination, "note.md").expect("read"), b"source");
        assert!(read(&root, "note.md").is_err(), "the source is gone");
    }

    #[test]
    fn move_dir_never_replaces_an_existing_entry() {
        let (_directory, root) = temp_root();
        root.create_dir("src").expect("create src");
        root.create_dir("dst").expect("create dst");
        root.create_dir("dst/taken").expect("create taken");
        let destination = root.open_dir_nofollow("dst").expect("open dst");
        let source = root.open_dir_nofollow("src").expect("open src");
        create_new(&source, "keep.md", b"kept").expect("create");
        create_new(
            &root.open_dir_nofollow("dst/taken").expect("open taken"),
            "victim.md",
            b"victim",
        )
        .expect("create");

        let error = move_dir(&root, "src", &destination, "taken").expect_err("must refuse");
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(
            read(
                &root.open_dir_nofollow("dst/taken").expect("open taken"),
                "victim.md"
            )
            .expect("read"),
            b"victim"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_root_is_refused() {
        let outer = tempfile::tempdir().expect("temp dir");
        std::fs::create_dir(outer.path().join("real")).expect("create real");
        std::os::unix::fs::symlink(outer.path().join("real"), outer.path().join("link"))
            .expect("symlink");

        assert!(
            open_root(&outer.path().join("link")).is_err(),
            "a symlinked vault root must be refused"
        );
        open_root(&outer.path().join("real")).expect("a real root opens");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_child_is_never_written_through() {
        let outer = tempfile::tempdir().expect("temp dir");
        let vault = outer.path().join("vault");
        std::fs::create_dir(&vault).expect("create vault");
        let outside = outer.path().join("outside.md");
        std::fs::write(&outside, b"untouched").expect("write outside");
        std::os::unix::fs::symlink(&outside, vault.join("trap.md")).expect("symlink");

        let root = open_root(&vault).expect("open root");

        assert!(
            create_new(&root, "trap.md", b"owned").is_err(),
            "create_new must refuse an existing symlink"
        );
        assert!(
            read(&root, "trap.md").is_err(),
            "a read must not follow the link"
        );
        // A replacement is bound to the file it validated, and a link cannot be
        // opened no-follow, so there is nothing to validate and the write is
        // refused before a single byte is produced.
        assert!(
            replace(&root, "trap.md", b"owned").is_err(),
            "a replacement through a link must be refused"
        );
        assert_eq!(
            std::fs::read(&outside).expect("read outside"),
            b"untouched",
            "the file the link pointed at must never be written"
        );
    }

    #[cfg(unix)]
    #[test]
    fn open_or_create_dir_refuses_a_symlink() {
        let outer = tempfile::tempdir().expect("temp dir");
        let vault = outer.path().join("vault");
        std::fs::create_dir(&vault).expect("create vault");
        std::fs::create_dir(outer.path().join("elsewhere")).expect("create elsewhere");
        std::os::unix::fs::symlink(outer.path().join("elsewhere"), vault.join(".bbb"))
            .expect("symlink");

        let root = open_root(&vault).expect("open root");
        let error = open_or_create_dir(&root, ".bbb").expect_err("a symlinked .bbb is refused");
        assert!(
            error.to_string().contains("not a real directory"),
            "{error}"
        );
    }

    /// On Linux the no-clobber directory rename is a single `renameat2` with
    /// `RENAME_NOREPLACE`, so there is no window between the check and the
    /// rename at all: the kernel performs both.
    #[cfg(target_os = "linux")]
    #[test]
    fn move_dir_is_atomic_on_linux() {
        let (_directory, root) = temp_root();
        root.create_dir("src").expect("create src");
        root.create_dir("dst").expect("create dst");
        root.create_dir("dst/taken").expect("create taken");
        let destination = root.open_dir_nofollow("dst").expect("open dst");

        let error = move_dir(&root, "src", &destination, "taken").expect_err("must refuse");
        assert_eq!(
            error.kind(),
            io::ErrorKind::AlreadyExists,
            "renameat2 reports a taken name as AlreadyExists"
        );
        assert!(root.exists("src"), "the source is untouched by a refusal");
    }

    /// Everywhere else the same refusal comes from a probe immediately before
    /// the rename. The guarantee is weaker by exactly one instruction gap, and
    /// the behaviour a caller sees is identical.
    #[cfg(not(target_os = "linux"))]
    #[test]
    fn move_dir_refuses_a_taken_name_without_renameat2() {
        let (_directory, root) = temp_root();
        root.create_dir("src").expect("create src");
        root.create_dir("dst").expect("create dst");
        root.create_dir("dst/taken").expect("create taken");
        let destination = root.open_dir_nofollow("dst").expect("open dst");

        let error = move_dir(&root, "src", &destination, "taken").expect_err("must refuse");
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert!(root.exists("src"));
    }

    /// The durability sequence differs by platform, but the *observable*
    /// contract does not: after `replace` returns, the destination holds the
    /// new bytes and nothing else was left in the directory.
    #[test]
    fn replace_has_the_same_observable_contract_on_every_platform() {
        let (directory, root) = temp_root();
        create_new(&root, "note.md", b"first").expect("create");
        replace(&root, "note.md", b"second").expect("replace");

        assert_eq!(read(&root, "note.md").expect("read"), b"second");
        let leftovers: Vec<String> = std::fs::read_dir(directory.path())
            .expect("read dir")
            .map(|entry| {
                entry
                    .expect("entry")
                    .file_name()
                    .to_string_lossy()
                    .into_owned()
            })
            .filter(|name| name.ends_with(".bbb-tmp"))
            .collect();
        assert!(leftovers.is_empty(), "temporary files left: {leftovers:?}");
    }

    /// Syncing a directory is a Unix idiom with no portable equivalent, so it
    /// is compiled out on other platforms rather than failing at runtime. Both
    /// forms must be callable and must not panic.
    #[test]
    fn sync_dir_is_callable_on_this_platform() {
        let (_directory, root) = temp_root();
        sync_dir(&root);
    }

    #[test]
    fn open_relative_dir_refuses_traversal() {
        let (_directory, root) = temp_root();
        assert!(open_relative_dir(&root, "..").is_err());
        assert!(open_relative_dir(&root, "a/../b").is_err());
        open_relative_dir(&root, "").expect("the root itself opens");
    }

    #[cfg(unix)]
    #[test]
    fn open_relative_dir_refuses_a_symlinked_component() {
        let outer = tempfile::tempdir().expect("temp dir");
        let vault = outer.path().join("vault");
        std::fs::create_dir(&vault).expect("create vault");
        std::fs::create_dir(outer.path().join("elsewhere")).expect("create elsewhere");
        std::os::unix::fs::symlink(outer.path().join("elsewhere"), vault.join("link"))
            .expect("symlink");

        let root = open_root(&vault).expect("open root");
        assert!(
            open_relative_dir(&root, "link").is_err(),
            "a symlinked directory component must not be traversed"
        );
    }
}
