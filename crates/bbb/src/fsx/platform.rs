//! The rename primitives, one implementation per platform.
//!
//! Three distinct operations hide behind the word "rename", and conflating them
//! is how files get destroyed:
//!
//! * [`rename_replacing`] deliberately replaces the destination. It is used
//!   only where this module's caller *owns* the destination — a temporary file
//!   it created, or a placeholder it just claimed.
//! * [`rename_no_replace`] must fail if anything is at the destination. There
//!   is no portable syscall for it, so each platform uses its own, and a
//!   platform with none refuses the operation instead of guessing.
//! * [`exchange`] atomically swaps two entries. Linux alone offers it, and the
//!   commit protocol uses it there to bind a write to the file it validated.
//!
//! # This is the crate's only `unsafe`
//!
//! Everything else in `bbb` is checked Rust. The FFI is confined here, each
//! call carries a SAFETY note, and every raw handle is borrowed from a live
//! owner for the duration of its call.

#![allow(unsafe_code)]

use std::io;

use cap_std::fs::Dir;

use super::component;

/// Rejects anything that is not one plain, portable path component.
///
/// Repeated here rather than left to `fsx`, because these functions reach the
/// operating system directly — on Windows by building an ambient path — and a
/// precondition that only the caller checks is one an FFI call does not have.
fn guard(name: &str) -> io::Result<()> {
    component::check(name).map_err(|error| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            format!("`{name}` is not a usable name: {error}"),
        )
    })
}

/// Renames `from` onto `to`, replacing whatever is there.
///
/// Callers must own the destination name. On Windows this is
/// `MoveFileExW(MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)`: the
/// replacement is atomic on one volume, and `WRITE_THROUGH` makes the operation
/// reach the disk before it returns, which is the closest Windows offers to the
/// directory `fsync` used on Unix.
///
/// # Errors
///
/// Returns the underlying I/O error.
pub(crate) fn rename_replacing(
    from: &Dir,
    from_name: &str,
    to: &Dir,
    to_name: &str,
) -> io::Result<()> {
    guard(from_name)?;
    guard(to_name)?;

    #[cfg(not(windows))]
    {
        from.rename(from_name, to, to_name)
    }

    #[cfg(windows)]
    {
        use windows_sys::Win32::Storage::FileSystem::{
            MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        move_file_ex(
            from,
            from_name,
            to,
            to_name,
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    }
}

/// Renames `from` onto `to`, failing if the destination name is taken.
///
/// # Errors
///
/// Returns [`io::ErrorKind::AlreadyExists`] when the destination is occupied,
/// [`io::ErrorKind::Unsupported`] on a platform with no such primitive, and any
/// other I/O error from the rename.
pub(crate) fn rename_no_replace(
    from: &Dir,
    from_name: &str,
    to: &Dir,
    to_name: &str,
) -> io::Result<()> {
    guard(from_name)?;
    guard(to_name)?;

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
        .map_err(|error| io::Error::from_raw_os_error(error.raw_os_error()))
    }

    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        use std::os::fd::AsRawFd as _;

        let from_c = CString::new(from_name).map_err(|_| invalid_name())?;
        let to_c = CString::new(to_name).map_err(|_| invalid_name())?;
        // SAFETY: both descriptors are borrowed from live `Dir` values that
        // outlive the call, and both strings are NUL-terminated and valid for
        // its duration. `RENAME_EXCL` makes the kernel fail rather than replace.
        let result = unsafe {
            libc::renameatx_np(
                from.as_raw_fd(),
                from_c.as_ptr(),
                to.as_raw_fd(),
                to_c.as_ptr(),
                libc::RENAME_EXCL,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(windows)]
    {
        // Without `MOVEFILE_REPLACE_EXISTING`, `MoveFileExW` fails when the
        // destination exists, which is exactly the guarantee wanted.
        use windows_sys::Win32::Storage::FileSystem::MOVEFILE_WRITE_THROUGH;
        move_file_ex(from, from_name, to, to_name, MOVEFILE_WRITE_THROUGH)
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos", windows)))]
    {
        let _ = (from, from_name, to, to_name);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "this platform has no rename that refuses to replace an existing entry",
        ))
    }
}

/// Atomically swaps two directory entries, which may be in different
/// directories.
///
/// After this returns, the first name refers to what the second named and vice
/// versa. Nothing is created or destroyed, and there is no instant in which
/// either name is missing — which is what lets a caller verify *afterwards*
/// that it swapped the entry it meant to, and put it back untouched if not.
///
/// # Errors
///
/// Returns [`io::ErrorKind::Unsupported`] where the platform has no exchange,
/// and any other I/O error from the operation.
pub(crate) fn exchange(
    first: &Dir,
    first_name: &str,
    second: &Dir,
    second_name: &str,
) -> io::Result<()> {
    guard(first_name)?;
    guard(second_name)?;

    #[cfg(target_os = "linux")]
    {
        use std::os::fd::AsFd as _;
        rustix::fs::renameat_with(
            first.as_fd(),
            first_name,
            second.as_fd(),
            second_name,
            rustix::fs::RenameFlags::EXCHANGE,
        )
        .map_err(|error| io::Error::from_raw_os_error(error.raw_os_error()))
    }

    #[cfg(target_os = "macos")]
    {
        use std::ffi::CString;
        use std::os::fd::AsRawFd as _;

        let first_c = CString::new(first_name).map_err(|_| invalid_name())?;
        let second_c = CString::new(second_name).map_err(|_| invalid_name())?;
        // SAFETY: both descriptors are borrowed from live `Dir` values that
        // outlive the call, and both strings are NUL-terminated and valid for
        // its duration. `RENAME_SWAP` exchanges the two entries atomically.
        let result = unsafe {
            libc::renameatx_np(
                first.as_raw_fd(),
                first_c.as_ptr(),
                second.as_raw_fd(),
                second_c.as_ptr(),
                libc::RENAME_SWAP,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(not(any(target_os = "linux", target_os = "macos")))]
    {
        let _ = (first, first_name, second, second_name);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "this platform has no atomic exchange",
        ))
    }
}

/// Whether [`exchange`] is implemented here.
pub(crate) const fn exchange_is_supported() -> bool {
    cfg!(any(target_os = "linux", target_os = "macos"))
}

/// Whether [`rename_no_replace`] is implemented here.
///
/// Production code never asks: it calls the operation and handles
/// [`io::ErrorKind::Unsupported`], which is one branch rather than two that
/// could disagree. The tests ask, so that each platform's expectation is
/// asserted rather than assumed.
#[cfg(test)]
pub(crate) const fn no_replace_is_supported() -> bool {
    cfg!(any(target_os = "linux", target_os = "macos", windows))
}

#[cfg(target_os = "macos")]
fn invalid_name() -> io::Error {
    io::Error::new(
        io::ErrorKind::InvalidInput,
        "a vault name cannot contain a NUL byte",
    )
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/// Calls `MoveFileExW` on paths derived from the two directory handles.
///
/// Windows has no `renameat`, so the operation must be expressed as paths. They
/// are derived from the handles already opened and validated rather than from
/// the strings the caller started with, so the rename targets the directories
/// that were checked even if a name above them was repointed since.
#[cfg(windows)]
fn move_file_ex(
    from: &Dir,
    from_name: &str,
    to: &Dir,
    to_name: &str,
    flags: u32,
) -> io::Result<()> {
    use windows_sys::Win32::Storage::FileSystem::MoveFileExW;

    // The names are joined onto ambient paths here, which is the one place in
    // the crate where a component's shape decides what the operating system
    // resolves. They are validated again immediately before that join.
    guard(from_name)?;
    guard(to_name)?;

    let source = wide(&directory_path(from)?.join(from_name));
    let destination = wide(&directory_path(to)?.join(to_name));

    // SAFETY: both buffers are NUL-terminated wide strings that live until the
    // call returns, and `flags` is a valid combination of `MOVEFILE_*` values.
    let ok = unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), flags) };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// The path of an open directory handle.
///
/// `GetFinalPathNameByHandleW` answers for the handle itself, so the path
/// cannot have drifted from the directory that was opened and checked.
#[cfg(windows)]
pub(crate) fn directory_path(dir: &Dir) -> io::Result<std::path::PathBuf> {
    use std::os::windows::ffi::OsStringExt as _;
    use std::os::windows::io::AsRawHandle as _;

    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_NAME_NORMALIZED, GetFinalPathNameByHandleW,
    };

    let handle = dir.as_raw_handle() as HANDLE;
    let mut capacity = 0u32;

    // `GetFinalPathNameByHandleW` reports "too small" by returning the size it
    // wants, *without* setting a last-error worth reading — so a short buffer
    // must be detected by comparing the return value with the capacity given,
    // and retried, never turned into `last_os_error()`. The loop is bounded
    // because a path that grows on every attempt is a filesystem racing us, not
    // a buffer to keep enlarging.
    for _ in 0..4 {
        if capacity == 0 {
            // SAFETY: `handle` is a live directory handle owned by `dir`.
            // A null buffer with length zero is the documented length query.
            let needed = unsafe {
                GetFinalPathNameByHandleW(handle, core::ptr::null_mut(), 0, FILE_NAME_NORMALIZED)
            };
            if needed == 0 {
                return Err(io::Error::last_os_error());
            }
            capacity = needed;
            continue;
        }

        let mut buffer = vec![0u16; capacity as usize];
        // SAFETY: as above, and `buffer` holds `capacity` writable elements.
        let written = unsafe {
            GetFinalPathNameByHandleW(handle, buffer.as_mut_ptr(), capacity, FILE_NAME_NORMALIZED)
        };
        if written == 0 {
            return Err(io::Error::last_os_error());
        }
        if written >= capacity {
            // The value is the required length, not an error. Grow and retry.
            capacity = written.saturating_add(1);
            continue;
        }
        buffer.truncate(written as usize);
        return Ok(std::path::PathBuf::from(std::ffi::OsString::from_wide(
            &buffer,
        )));
    }

    Err(io::Error::new(
        io::ErrorKind::InvalidData,
        "the directory path kept growing between queries",
    ))
}

/// Asks Windows what object a handle refers to.
///
/// The volume serial plus the file index is Windows' answer to the inode.
/// cap-std exposes it only behind an unstable `std` feature, so the call is
/// made here — in the one module allowed to make calls like this.
///
/// # Errors
///
/// Returns the underlying I/O error.
#[cfg(windows)]
pub(crate) fn handle_identity(raw: std::os::windows::io::RawHandle) -> io::Result<(u64, u64)> {
    use windows_sys::Win32::Foundation::HANDLE;
    use windows_sys::Win32::Storage::FileSystem::{
        BY_HANDLE_FILE_INFORMATION, GetFileInformationByHandle,
    };

    // SAFETY: `BY_HANDLE_FILE_INFORMATION` is a plain-old-data struct of
    // integers, for which an all-zero bit pattern is a valid value.
    let mut information: BY_HANDLE_FILE_INFORMATION = unsafe { core::mem::zeroed() };
    // SAFETY: `raw` is borrowed from a live handle that outlives this call, and
    // `information` is a correctly sized, writable output buffer.
    let ok = unsafe { GetFileInformationByHandle(raw as HANDLE, &raw mut information) };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }

    let number =
        (u64::from(information.nFileIndexHigh) << 32) | u64::from(information.nFileIndexLow);
    Ok((u64::from(information.dwVolumeSerialNumber), number))
}

/// Encodes a path as a NUL-terminated wide string.
#[cfg(windows)]
fn wide(path: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt as _;
    path.as_os_str().encode_wide().chain(Some(0)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_platform_reports_its_own_capabilities_consistently() {
        // These are the two facts the rest of the crate branches on; a platform
        // that answers `true` must actually implement the operation, which the
        // behavioural tests below check.
        assert_eq!(
            exchange_is_supported(),
            cfg!(any(target_os = "linux", target_os = "macos"))
        );
        assert_eq!(
            no_replace_is_supported(),
            cfg!(any(target_os = "linux", target_os = "macos", windows))
        );
    }

    #[test]
    fn no_replace_refuses_a_taken_name_where_it_is_supported() {
        let directory = tempfile::tempdir().expect("temp dir");
        let root = crate::fsx::open_root(directory.path()).expect("open root");
        crate::fsx::create_new(&root, "source.md", b"source").expect("create");
        crate::fsx::create_new(&root, "victim.md", b"victim").expect("create");

        let outcome = rename_no_replace(&root, "source.md", &root, "victim.md");
        if no_replace_is_supported() {
            let error = outcome.expect_err("a taken name must be refused");
            assert_eq!(error.kind(), io::ErrorKind::AlreadyExists);
            assert_eq!(
                crate::fsx::read(&root, "victim.md").expect("read"),
                b"victim",
                "the entry already there survives"
            );
        } else {
            assert_eq!(
                outcome.expect_err("unsupported platforms refuse").kind(),
                io::ErrorKind::Unsupported
            );
        }
    }

    #[test]
    fn exchange_swaps_both_names_where_it_is_supported() {
        let directory = tempfile::tempdir().expect("temp dir");
        let root = crate::fsx::open_root(directory.path()).expect("open root");
        crate::fsx::create_new(&root, "a.md", b"A").expect("create");
        crate::fsx::create_new(&root, "b.md", b"B").expect("create");

        let outcome = exchange(&root, "a.md", &root, "b.md");
        if exchange_is_supported() {
            outcome.expect("exchange");
            assert_eq!(crate::fsx::read(&root, "a.md").expect("read"), b"B");
            assert_eq!(crate::fsx::read(&root, "b.md").expect("read"), b"A");
        } else {
            assert_eq!(
                outcome.expect_err("unsupported platforms refuse").kind(),
                io::ErrorKind::Unsupported
            );
        }
    }

    #[test]
    fn rename_replacing_replaces() {
        let directory = tempfile::tempdir().expect("temp dir");
        let root = crate::fsx::open_root(directory.path()).expect("open root");
        crate::fsx::create_new(&root, "new.md", b"new").expect("create");
        crate::fsx::create_new(&root, "old.md", b"old").expect("create");

        rename_replacing(&root, "new.md", &root, "old.md").expect("rename");
        assert_eq!(crate::fsx::read(&root, "old.md").expect("read"), b"new");
        assert!(crate::fsx::read(&root, "new.md").is_err());
    }
}
