//! Shared helpers for the integration tests.
//!
//! Deliberately dependency-free, like the crate under test.

#![allow(dead_code, reason = "each integration test binary uses a subset")]

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

/// The committed fixture root.
pub(crate) fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

/// Reads a fixture as raw bytes, so that byte order marks, CRLF and invalid
/// UTF-8 reach the parser exactly as they are stored.
pub(crate) fn read_fixture(relative: &str) -> Vec<u8> {
    let path = fixtures().join(relative);
    fs::read(&path).unwrap_or_else(|error| panic!("reading {}: {error}", path.display()))
}

/// Compares `actual` against a committed golden file.
///
/// Set `UPDATE_GOLDEN=1` to rewrite the golden instead of failing; the new file
/// is then reviewed like any other change.
pub(crate) fn assert_golden(relative: &str, actual: &str) {
    let path = fixtures().join(relative);
    if std::env::var_os("UPDATE_GOLDEN").is_some() {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("creating the golden directory");
        }
        fs::write(&path, actual).expect("writing the golden file");
        return;
    }

    let expected = fs::read_to_string(&path).unwrap_or_else(|error| {
        panic!(
            "reading golden {}: {error}\nre-run with UPDATE_GOLDEN=1 to create it",
            path.display()
        )
    });
    assert_eq!(
        actual,
        expected,
        "golden {} is out of date; re-run with UPDATE_GOLDEN=1 to update it",
        path.display()
    );
}

/// A temporary directory that removes itself when it goes out of scope.
#[derive(Debug)]
pub(crate) struct TempDir {
    path: PathBuf,
}

impl TempDir {
    /// Creates a uniquely named directory under the system temporary directory.
    pub(crate) fn new(label: &str) -> Self {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let unique = COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "bookmarks-but-better-vault-core-{}-{label}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("creating a temporary directory");
        Self { path }
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    /// Writes `contents` to `relative`, creating parent directories.
    pub(crate) fn write(&self, relative: &str, contents: impl AsRef<[u8]>) -> PathBuf {
        let path = self.path.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("creating a fixture directory");
        }
        fs::write(&path, contents).expect("writing a fixture file");
        path
    }

    /// Creates the directory `relative`.
    pub(crate) fn mkdir(&self, relative: &str) -> PathBuf {
        let path = self.path.join(relative);
        fs::create_dir_all(&path).expect("creating a fixture directory");
        path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

/// Whether `directory` lives on a case-sensitive filesystem.
///
/// Case-collision behaviour can only be exercised where two names differing by
/// case can actually coexist.
pub(crate) fn is_case_sensitive(directory: &Path) -> bool {
    let lower = directory.join("bookmarks-but-better-case-probe");
    let upper = directory.join("BOOKMARKS-BUT-BETTER-CASE-PROBE");
    if fs::write(&lower, b"a").is_err() {
        return false;
    }
    let distinct =
        fs::write(&upper, b"b").is_ok() && fs::read(&lower).is_ok_and(|read| read == b"a");
    let _ = fs::remove_file(&lower);
    let _ = fs::remove_file(&upper);
    distinct
}

/// Renders a minimal bookmark file with LF endings.
pub(crate) fn bookmark_source(id: &str, url: &str, title: &str) -> String {
    format!(
        "---\nbookmarks_but_better_id: {id}\nbookmarks_but_better_url: {url}\nbookmarks_but_better_title: {title}\n\
         bookmarks_but_better_created: 2026-01-01T00:00:00Z\nbookmarks_but_better_updated: 2026-01-01T00:00:00Z\n---\n"
    )
}

/// Renders a minimal folder metadata file with LF endings.
pub(crate) fn folder_source(id: &str, title: Option<&str>) -> String {
    let title = title.map_or_else(String::new, |title| {
        format!("bookmarks_but_better_title: {title}\n")
    });
    format!("---\nbookmarks_but_better_id: {id}\n{title}---\n")
}
