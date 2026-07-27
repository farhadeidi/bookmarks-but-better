//! The identity of an open file, used to bind a commit to what was validated.
//!
//! Comparing content alone cannot tell "the file I read" from "a different file
//! with the same bytes that replaced it". Comparing the *name* cannot tell them
//! apart either, because a name is just a directory entry somebody else can
//! repoint. What distinguishes them is the object the operating system knows:
//! the inode on Unix, the volume serial plus file index on Windows.
//!
//! Every platform that can answer that question is asked. One that cannot says
//! so, and the caller falls back to content comparison alone — which is weaker,
//! and is documented as weaker rather than quietly presented as the same thing.

use std::io;

use cap_std::fs::{Dir, File};

/// What the operating system calls one file, independent of its name.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileIdentity {
    /// The kernel identified the file.
    Known {
        /// Filesystem or volume.
        volume: u64,
        /// Inode or file index within that volume.
        number: u64,
    },
    /// This platform offers no stable identity through a handle.
    ///
    /// Callers must not treat two `Unavailable` values as equal, and none of
    /// the comparisons here do. Unconstructed on Unix and Windows, which both
    /// answer the question; kept so the fallback is expressible rather than
    /// implicit.
    #[cfg_attr(any(unix, windows), allow(dead_code))]
    Unavailable,
}

impl FileIdentity {
    /// Whether two observations are provably the same file.
    ///
    /// `Unavailable` is never provably anything, so it answers `false` and the
    /// caller is pushed onto the content check it must do anyway.
    pub(crate) fn is_same(self, other: Self) -> bool {
        match (self, other) {
            (
                Self::Known { volume, number },
                Self::Known {
                    volume: other_volume,
                    number: other_number,
                },
            ) => volume == other_volume && number == other_number,
            _ => false,
        }
    }

    /// Whether the platform could identify the file at all.
    pub(crate) const fn is_known(self) -> bool {
        matches!(self, Self::Known { .. })
    }
}

/// Reads the identity of an already-open directory.
///
/// A directory has an identity for the same reason a file does: the name that
/// leads to it is a directory entry somebody else can repoint, and a delete
/// aimed at a name must be able to prove it is still aimed at the thing that
/// was verified.
///
/// # Errors
///
/// Returns the underlying I/O error from inspecting the handle.
#[cfg(unix)]
pub(crate) fn of_dir(dir: &Dir) -> io::Result<FileIdentity> {
    use cap_std::fs::MetadataExt as _;

    let metadata = dir.dir_metadata()?;
    Ok(FileIdentity::Known {
        volume: metadata.dev(),
        number: metadata.ino(),
    })
}

/// As above, using `GetFileInformationByHandle`.
#[cfg(windows)]
pub(crate) fn of_dir(dir: &Dir) -> io::Result<FileIdentity> {
    use std::os::windows::io::AsRawHandle as _;
    from_raw_handle(dir.as_raw_handle())
}

/// As above, on a platform with no handle-based identity.
#[cfg(not(any(unix, windows)))]
pub(crate) fn of_dir(_dir: &Dir) -> io::Result<FileIdentity> {
    Ok(FileIdentity::Unavailable)
}

/// Reads the identity of an already-open file.
///
/// # Errors
///
/// Returns the underlying I/O error from inspecting the handle.
#[cfg(unix)]
pub(crate) fn of(file: &File) -> io::Result<FileIdentity> {
    use cap_std::fs::MetadataExt as _;

    let metadata = file.metadata()?;
    Ok(FileIdentity::Known {
        volume: metadata.dev(),
        number: metadata.ino(),
    })
}

/// As above, using `GetFileInformationByHandle`.
///
/// cap-std exposes `file_index` only behind an unstable `std` feature, so the
/// call is made directly rather than waiting for it to stabilise.
#[cfg(windows)]
pub(crate) fn of(file: &File) -> io::Result<FileIdentity> {
    use std::os::windows::io::AsRawHandle as _;
    from_raw_handle(file.as_raw_handle())
}

/// Builds an identity from a raw handle, via the crate's FFI module.
#[cfg(windows)]
fn from_raw_handle(raw: std::os::windows::io::RawHandle) -> io::Result<FileIdentity> {
    let (volume, number) = super::platform::handle_identity(raw)?;
    Ok(FileIdentity::Known { volume, number })
}

/// As above, on a platform with no handle-based identity.
#[cfg(not(any(unix, windows)))]
pub(crate) fn of(_file: &File) -> io::Result<FileIdentity> {
    Ok(FileIdentity::Unavailable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unavailable_is_never_the_same_as_anything() {
        assert!(!FileIdentity::Unavailable.is_same(FileIdentity::Unavailable));
        assert!(!FileIdentity::Unavailable.is_known());
        let known = FileIdentity::Known {
            volume: 1,
            number: 2,
        };
        assert!(!known.is_same(FileIdentity::Unavailable));
        assert!(!FileIdentity::Unavailable.is_same(known));
    }

    #[test]
    fn a_known_identity_matches_only_itself() {
        let one = FileIdentity::Known {
            volume: 1,
            number: 2,
        };
        assert!(one.is_same(one));
        assert!(!one.is_same(FileIdentity::Known {
            volume: 1,
            number: 3
        }));
        assert!(!one.is_same(FileIdentity::Known {
            volume: 9,
            number: 2
        }));
    }

    #[cfg(any(unix, windows))]
    #[test]
    fn two_names_for_one_file_share_an_identity_and_two_files_do_not() {
        let directory = tempfile::tempdir().expect("temp dir");
        let root = crate::fsx::open_root(directory.path()).expect("open root");
        crate::fsx::create_new(&root, "one.md", b"same").expect("create");
        crate::fsx::create_new(&root, "two.md", b"same").expect("create");

        let first = crate::fsx::read_with_identity(&root, "one.md").expect("read");
        let again = crate::fsx::read_with_identity(&root, "one.md").expect("read");
        let other = crate::fsx::read_with_identity(&root, "two.md").expect("read");

        assert!(first.identity.is_known(), "this platform identifies files");
        assert!(
            first.identity.is_same(again.identity),
            "the same file keeps its identity across opens"
        );
        assert_eq!(first.bytes, other.bytes, "the contents are identical");
        assert!(
            !first.identity.is_same(other.identity),
            "identical bytes are still two different files"
        );
    }
}
