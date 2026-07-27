//! Durable, same-directory file replacement.
//!
//! Every write to a vault file goes through [`replace`]. The sequence is the
//! standard one, and each step exists for a reason:
//!
//! 1. Write the new bytes to a temporary file **in the destination directory**,
//!    so the final step is a rename within one filesystem and can therefore be
//!    atomic. A temporary file in `/tmp` would make the last step a copy.
//! 2. `fsync` the temporary file, so its contents reach the disk *before* any
//!    name points at them. Without this a crash can leave the destination name
//!    pointing at a file of zeroes.
//! 3. Rename over the destination, which is atomic on POSIX and on Windows via
//!    `ReplaceFile`/`MoveFileEx`. A reader either sees all of the old bytes or
//!    all of the new ones, never a half-written file.
//! 4. `fsync` the containing directory, so the rename itself is durable.
//!
//! Step 4 is where "best available guarantees" becomes platform-specific:
//! directory syncing is meaningful on Unix and is not available on Windows, so
//! the failure is tolerated rather than propagated.

use std::fs::{self, File};
use std::io::{self, Write as _};
use std::path::Path;

/// Writes `bytes` to `path`, replacing whatever is there, atomically.
///
/// # Errors
///
/// Returns any I/O error from creating, writing, syncing or renaming. On
/// failure the destination still holds its previous contents, and a temporary
/// file may be left behind for the user to inspect.
pub(crate) fn replace(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let directory = path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "a vault file always has a parent directory",
        )
    })?;
    let file_name = path.file_name().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "a vault file always has a file name",
        )
    })?;

    // The temporary name stays inside the destination directory so the rename
    // below cannot cross a filesystem boundary. It is prefixed with a dot so
    // that a crash between steps leaves something the scanner already ignores
    // rather than a stray Markdown file that would show up as a bookmark.
    let temporary = directory.join(format!(
        ".{}.bbb-tmp",
        file_name.to_string_lossy().replace('/', "_")
    ));

    let write_result = (|| -> io::Result<()> {
        let mut file = File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }

    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }

    sync_directory(directory);
    Ok(())
}

/// Creates `path` with `bytes`, refusing to touch an existing file.
///
/// Creation uses `create_new`, so two writers racing for the same new name
/// cannot both believe they won. The durability steps match [`replace`].
///
/// # Errors
///
/// Returns [`io::ErrorKind::AlreadyExists`] when the path is taken, and any
/// other I/O error from the write.
pub(crate) fn create_new(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut file = File::create_new(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    if let Some(directory) = path.parent() {
        sync_directory(directory);
    }
    Ok(())
}

/// Flushes a directory entry change to disk where the platform supports it.
///
/// Opening a directory as a file and syncing it is a Unix idiom; on Windows it
/// fails, and there is no portable equivalent, so the error is dropped. The
/// preceding rename is still atomic there — only its durability across a power
/// loss is weaker, which is the documented "best available" guarantee.
fn sync_directory(directory: &Path) {
    if let Ok(handle) = File::open(directory) {
        let _ = handle.sync_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replace_overwrites_existing_content() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        replace(&path, b"first").expect("first write");
        replace(&path, b"second").expect("second write");
        assert_eq!(fs::read(&path).expect("read"), b"second");
    }

    #[test]
    fn replace_leaves_no_temporary_file_behind() {
        let dir = tempfile::tempdir().expect("temp dir");
        replace(&dir.path().join("note.md"), b"x").expect("write");
        let names: Vec<_> = fs::read_dir(dir.path())
            .expect("read dir")
            .map(|entry| entry.expect("entry").file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("note.md")]);
    }

    #[test]
    fn create_new_refuses_an_existing_path() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("note.md");
        create_new(&path, b"first").expect("first write");
        let error = create_new(&path, b"second").expect_err("second write must fail");
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read(&path).expect("read"), b"first");
    }
}
