//! The read-only health report behind `bbb doctor`.
//!
//! Doctor never writes. Its job is to turn a scan into something a person can
//! act on, and to exit non-zero when the vault holds a problem that makes an
//! entry read-only — so it can be used in a script.

use std::path::Path;

use bbb_vault_core::{Severity, VaultScan, scan};

/// A summary of one vault.
#[derive(Debug, Clone)]
pub struct Report {
    /// How many bookmarks were found.
    pub bookmarks: usize,
    /// How many directories were found, excluding the root.
    pub folders: usize,
    /// Problems that make an entry read-only.
    pub errors: Vec<Finding>,
    /// Problems worth showing that do not block writes.
    pub warnings: Vec<Finding>,
    /// Whether the root has a usable `.bbb-folder.md`.
    pub initialized: bool,
}

/// One diagnostic, flattened for printing.
#[derive(Debug, Clone)]
pub struct Finding {
    /// The stable machine-readable classification.
    pub code: &'static str,
    /// The vault-relative path it concerns.
    pub path: String,
    /// The human-facing explanation.
    pub detail: String,
}

impl Report {
    /// Whether anything makes an entry read-only.
    #[must_use]
    pub fn is_healthy(&self) -> bool {
        self.errors.is_empty() && self.initialized
    }
}

/// Scans `root` and summarises it.
///
/// # Errors
///
/// Returns any I/O error from the scan, including the refusal to treat a
/// symbolic link as a vault root.
pub fn examine(root: &Path) -> std::io::Result<Report> {
    let scan = scan(root)?;
    Ok(summarize(&scan))
}

fn summarize(scan: &VaultScan) -> Report {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    for diagnostic in scan.diagnostics() {
        let finding = Finding {
            code: diagnostic.code().as_str(),
            path: diagnostic.path().unwrap_or(".").to_owned(),
            detail: diagnostic.detail().to_owned(),
        };
        match diagnostic.severity() {
            Severity::Error => errors.push(finding),
            Severity::Warning => warnings.push(finding),
        }
    }

    Report {
        bookmarks: scan.bookmarks().count(),
        folders: count_folders(scan.folder()),
        errors,
        warnings,
        initialized: scan.folder().id().is_some(),
    }
}

fn count_folders(folder: &bbb_vault_core::FolderNode) -> usize {
    folder.folders().len() + folder.folders().iter().map(count_folders).sum::<usize>()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_uninitialized_directory_is_not_healthy() {
        let dir = tempfile::tempdir().expect("temp dir");
        let report = examine(dir.path()).expect("examine");
        assert!(!report.initialized);
        assert!(!report.is_healthy());
    }

    #[test]
    fn a_freshly_initialized_vault_is_healthy_and_empty() {
        let dir = tempfile::tempdir().expect("temp dir");
        crate::init::initialize(dir.path()).expect("init");
        let report = examine(dir.path()).expect("examine");
        assert!(report.is_healthy(), "{:?}", report.errors);
        assert_eq!(report.bookmarks, 0);
        assert_eq!(report.folders, 0);
    }
}
