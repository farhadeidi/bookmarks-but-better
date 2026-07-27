//! The read-only health report behind `bbb doctor`.
//!
//! Doctor never writes. Its job is to turn a scan into something a person can
//! act on, and to exit non-zero when the vault holds a problem that makes an
//! entry read-only — so it can be used in a script.
//!
//! It also looks in `.bbb/staging`, which no scan covers: entries a crashed run
//! left behind and that recovery could not resolve live there, and a user who
//! never reads the daemon's log needs some way to find out.

use std::path::Path;

use bbb_vault_core::{FolderNode, Severity, StateAccess, VaultScan, scan};

/// A summary of one vault.
#[derive(Debug, Clone)]
pub struct Report {
    /// Whether a daemon currently holds the vault's lock.
    ///
    /// Reported for context: a vault being served can change between the scan
    /// and the moment the report is read.
    pub daemon_running: bool,
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
    /// Folders whose child order file the daemon must not rewrite, so their
    /// entries cannot be reordered until a person fixes or removes it.
    ///
    /// Reported separately from `warnings` because the fix is a specific one —
    /// repair or delete one named file — and because it is the only thing that
    /// silently takes a feature away rather than an entry.
    pub unorderable: Vec<Finding>,
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
    let mut report = summarize(&scan);
    report.errors.extend(staged_findings(root));
    report.daemon_running = daemon_is_running(root);
    Ok(report)
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

    let mut unorderable = Vec::new();
    collect_unorderable(scan.folder(), &mut unorderable);

    Report {
        daemon_running: false,
        bookmarks: scan.bookmarks().count(),
        folders: count_folders(scan.folder()),
        errors,
        warnings,
        initialized: scan.folder().id().is_some(),
        unorderable,
    }
}

/// Every folder whose recorded child order is stuck read-only.
fn collect_unorderable(folder: &FolderNode, out: &mut Vec<Finding>) {
    if folder.state_access() == StateAccess::ReadOnly {
        out.push(Finding {
            code: "state_read_only",
            path: if folder.relative_path().is_empty() {
                ".".to_owned()
            } else {
                folder.relative_path().to_owned()
            },
            detail: "this folder's `.bbb-state.json` holds something this build must not \
                     overwrite, so its entries cannot be reordered; the folder's own diagnostics \
                     say what, and removing the file restores the migration order"
                .to_owned(),
        });
    }
    for child in folder.folders() {
        collect_unorderable(child, out);
    }
}

fn count_folders(folder: &bbb_vault_core::FolderNode) -> usize {
    folder
        .folders()
        .map(|child| 1 + count_folders(child))
        .sum::<usize>()
}

/// Entries in `.bbb/staging` that need a person.
///
/// The judgement itself lives in the staging module, so `doctor` and recovery
/// cannot disagree about what counts as stuck. A staging directory is *not* by
/// itself a problem: a running daemon creates one for the duration of every
/// delete, and reporting that would make `doctor` fail at random during
/// ordinary use.
///
/// Read-only: recovery happens when a daemon takes the lock, and doing it from
/// `doctor` would race that daemon.
fn staged_findings(root: &Path) -> Vec<Finding> {
    let Ok(handle) = crate::fsx::open_root(root) else {
        return Vec::new();
    };
    let Ok(state) = crate::fsx::open_state_dir(&handle) else {
        return Vec::new();
    };

    crate::staging::needs_attention(&state)
        .into_iter()
        .map(|(path, detail)| Finding {
            code: "staged_entries_retained",
            path,
            detail,
        })
        .collect()
}

/// Whether another process currently holds this vault.
///
/// Reported so that a person reading `doctor` output knows whether what they
/// are looking at can change underneath them.
fn daemon_is_running(root: &Path) -> bool {
    let Ok(handle) = std::fs::File::options()
        .read(true)
        .write(true)
        .open(root.join(".bbb").join("lock"))
    else {
        return false;
    };
    match handle.try_lock() {
        Ok(()) => {
            let _ = handle.unlock();
            false
        }
        Err(std::fs::TryLockError::WouldBlock) => true,
        Err(std::fs::TryLockError::Error(_)) => false,
    }
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
        assert!(report.unorderable.is_empty());
    }

    #[test]
    fn a_child_order_file_that_cannot_be_rewritten_is_named() {
        let dir = tempfile::tempdir().expect("temp dir");
        crate::init::initialize(dir.path()).expect("init");
        std::fs::create_dir(dir.path().join("Dev")).expect("create dir");
        std::fs::write(
            dir.path()
                .join("Dev")
                .join(bbb_vault_core::FOLDER_FILE_NAME),
            "---\nbbb_id: 1111aaaa\n---\n",
        )
        .expect("metadata");
        std::fs::write(
            dir.path().join("Dev").join(bbb_vault_core::STATE_FILE_NAME),
            "{ not json",
        )
        .expect("order file");

        let report = examine(dir.path()).expect("examine");

        assert_eq!(report.unorderable.len(), 1, "{:?}", report.unorderable);
        assert_eq!(report.unorderable[0].path, "Dev");
        assert_eq!(report.unorderable[0].code, "state_read_only");
        assert!(
            report.is_healthy(),
            "an order file nobody can rewrite is not a reason to fail a script: {:?}",
            report.errors
        );
        assert!(
            report
                .warnings
                .iter()
                .any(|finding| finding.code == "state_malformed"),
            "{:?}",
            report.warnings
        );
    }
}
