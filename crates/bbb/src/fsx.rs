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

use std::io::{self, Read as _, Write as _};

use cap_fs_ext::{DirExt as _, FollowSymlinks, OpenOptionsFollowExt as _};
use cap_std::ambient_authority;
use cap_std::fs::{Dir, OpenOptions};
use std::path::{Component, Path};

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
    let mut current = root.try_clone()?;
    for component in relative.split('/').filter(|part| !part.is_empty()) {
        if component == "." || component == ".." {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "a vault-relative path never contains `.` or `..`",
            ));
        }
        current = current.open_dir_nofollow(component)?;
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
    let mut file = dir.open_with(name, &create_new_options())?;
    file.write_all(bytes)?;
    file.sync_all()?;
    sync_dir(dir);
    Ok(())
}

/// Durably replaces `name` with `bytes`.
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
/// 3. Rename over `name`. This is atomic on POSIX, and on Windows it lands on
///    `MoveFileExW` with `MOVEFILE_REPLACE_EXISTING`, which is atomic on a
///    single volume. A reader sees all of the old bytes or all of the new ones.
/// 4. `fsync` the directory, so the rename itself survives a power loss. This
///    step is Unix-only: Windows has no portable equivalent, and its absence is
///    why the durability guarantee is documented as "best available" rather
///    than "identical everywhere".
///
/// # Errors
///
/// Returns any I/O error from the sequence. On failure the destination still
/// holds its previous bytes and the temporary file is removed.
pub(crate) fn replace(dir: &Dir, name: &str, bytes: &[u8]) -> io::Result<()> {
    // The name and the open handle come back together. Claiming a name and
    // then reopening it by that name would be two resolutions of one string —
    // exactly the pattern this module exists to avoid.
    let (temporary, mut file) = create_temp(dir, name)?;

    let write = file.write_all(bytes).and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = write {
        let _ = dir.remove_file(&temporary);
        return Err(error);
    }

    if let Err(error) = dir.rename(&temporary, dir, name) {
        let _ = dir.remove_file(&temporary);
        return Err(error);
    }

    sync_dir(dir);
    Ok(())
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
    // Claiming the name is the whole point: between this and the rename, no
    // other writer can take it, because it is already taken by us.
    let placeholder = to.open_with(to_name, &create_new_options())?;
    drop(placeholder);

    if let Err(error) = from.rename(from_name, to, to_name) {
        let _ = to.remove_file(to_name);
        return Err(error);
    }

    sync_dir(from);
    sync_dir(to);
    Ok(())
}

/// Moves a directory between handles without ever replacing anything.
///
/// On Linux this is one `renameat2` with `RENAME_NOREPLACE`, which the kernel
/// guarantees will fail rather than clobber — there is no window at all.
///
/// Elsewhere there is no such syscall exposed, and a directory cannot be
/// reserved the way a file can: creating a placeholder directory would have to
/// be removed again before the rename, reopening the very gap it was meant to
/// close. So the destination is probed with a no-follow `symlink_metadata` and
/// the rename follows immediately. The residual window is documented rather
/// than papered over: it is small, it requires an adversary writing into the
/// destination directory at that instant, and closing it needs a syscall those
/// platforms do not offer.
///
/// # Errors
///
/// Returns [`io::ErrorKind::AlreadyExists`] when the destination name is taken,
/// and any other I/O error from the rename.
pub(crate) fn move_dir(from: &Dir, from_name: &str, to: &Dir, to_name: &str) -> io::Result<()> {
    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsFd as _;
        rustix::fs::renameat_with(
            from.as_fd(),
            from_name,
            to.as_fd(),
            to_name,
            rustix::fs::RenameFlags::NOREPLACE,
        )
        .map_err(|error| io::Error::from_raw_os_error(error.raw_os_error()))?;
    }

    #[cfg(not(target_os = "linux"))]
    {
        if to.symlink_metadata(to_name).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "the destination name is already taken",
            ));
        }
        from.rename(from_name, to, to_name)?;
    }

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
pub(crate) fn open_or_create_dir(dir: &Dir, name: &str) -> io::Result<Dir> {
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
        // A replace writes a fresh temporary and renames over the link, which
        // removes the link. What must never happen is the target changing.
        replace(&root, "trap.md", b"owned").expect("replace");
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
