//! The registry of Vaults one daemon hosts.
//!
//! One daemon process may host one or more independently identified Vaults
//! through one loopback connection (ADR-0001). This module is the lifecycle
//! layer above [`Vault`]: it validates the configured set up front, opens all
//! of them or none of them, and answers the two questions the API needs
//! answered per request — "which Vaults exist" (discovery) and "which one does
//! this address name" (scoping).
//!
//! [`Vault`] itself stays exactly as deep as it was: the operation gate, the
//! snapshot, the change channel, the mutation rules and the lock are all
//! per-Vault concerns and are not shared, wrapped or re-implemented here.
//!
//! # Why the configured set is validated before anything opens
//!
//! Duplicate Vault ids and overlapping roots are configuration mistakes. They
//! are cheapest to reject before a single lock is taken, because rejecting
//! them after some Vaults have opened means releasing those locks again — and
//! a set that is validated up front can then be opened without re-checking,
//! keeping the open loop simple. Overlap is checked lexically, on the
//! normalized absolute path, without resolving symbolic links: a symlinked
//! root is already refused by the scanner, and canonicalising here would
//! quietly accept what the scanner refuses.

use std::collections::HashSet;
use std::io;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use crate::fsx;
use crate::lock::{LockError, VaultLock};
use crate::staging;
use crate::vault::Vault;

/// The id a plain `--vault PATH` configuration receives.
///
/// It exists so the single-Vault command line stays exactly as it was before
/// Vaults had ids. Two plain paths both claim it, which the duplicate-id check
/// rejects with an error that names the `ID=PATH` spelling — the user is never
/// left guessing how to say what they meant.
pub const DEFAULT_VAULT_ID: &str = "default";

/// One Vault as it was configured on the command line.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VaultSpec {
    /// The Vault's id, unique within one daemon. A slug: lowercase ASCII
    /// alphanumerics and hyphens, so it is safe as a path segment.
    pub id: String,
    /// The Vault's root directory.
    pub path: PathBuf,
}

impl VaultSpec {
    /// A spec with an explicit id.
    #[must_use]
    pub fn new(id: impl Into<String>, path: impl Into<PathBuf>) -> Self {
        Self {
            id: id.into(),
            path: path.into(),
        }
    }

    /// Parses one `--vault` argument: `ID=PATH` or a plain `PATH`.
    ///
    /// # Errors
    ///
    /// Returns the argument unchanged in the error when it carries no path.
    pub fn parse(argument: &str) -> Result<Self, String> {
        let (id, path) = match argument.split_once('=') {
            Some((id, path)) => (id.trim().to_owned(), path.trim().to_owned()),
            None => (DEFAULT_VAULT_ID.to_owned(), argument.trim().to_owned()),
        };
        if path.is_empty() {
            return Err(argument.to_owned());
        }
        Ok(Self {
            id,
            path: PathBuf::from(path),
        })
    }
}

/// Why a configured set of Vaults cannot be hosted.
#[derive(Debug)]
pub enum RegistryError {
    /// Two configured Vaults claim the same id.
    DuplicateId {
        /// The id claimed more than once.
        id: String,
    },
    /// A configured id is not a usable slug.
    InvalidId {
        /// The rejected id.
        id: String,
    },
    /// One configured root contains (or equals) another.
    OverlappingRoots {
        /// The outer root.
        outer: PathBuf,
        /// The root it contains.
        inner: PathBuf,
    },
    /// No Vault was configured.
    Empty,
    /// A Vault could not be opened. Startup is atomic: when this is returned,
    /// every Vault whose open had already succeeded has been released again.
    Open {
        /// The id of the Vault that failed.
        id: String,
        /// The path that failed.
        path: PathBuf,
        /// Why.
        error: io::Error,
    },
    /// A Vault is not initialized.
    NotAVault {
        /// The id of the Vault that is not initialized.
        id: String,
        /// The directory that was pointed at.
        path: PathBuf,
    },
    /// Another process holds the Vault.
    Locked {
        /// The id of the Vault that is held.
        id: String,
        /// The lock error.
        error: LockError,
    },
}

impl core::fmt::Display for RegistryError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::DuplicateId { id } => write!(
                f,
                "two configured vaults claim the id `{id}`; give each one its own `ID=PATH`"
            ),
            Self::InvalidId { id } => write!(
                f,
                "`{id}` is not a usable vault id; use lowercase letters, digits and hyphens"
            ),
            Self::OverlappingRoots { outer, inner } => write!(
                f,
                "the vault roots {} and {} overlap; host sibling directories instead",
                outer.display(),
                inner.display()
            ),
            Self::Empty => write!(f, "no vault was configured"),
            Self::Open { id, path, error } => {
                write!(
                    f,
                    "the vault `{id}` at {} could not be opened: {error}",
                    path.display()
                )
            }
            Self::NotAVault { id, path } => write!(
                f,
                "the vault `{id}` at {} is not an initialized vault (no {} at its root)\n         run: bookmarks-but-better init --vault {}\n         or:  bookmarks-but-better serve --vault {} --init",
                path.display(),
                bookmarks_but_better_vault_core::FOLDER_FILE_NAME,
                path.display(),
                path.display(),
            ),
            Self::Locked { id, error } => write!(f, "the vault `{id}` is locked: {error}"),
        }
    }
}

impl core::error::Error for RegistryError {
    fn source(&self) -> Option<&(dyn core::error::Error + 'static)> {
        match self {
            Self::Open { error, .. } => Some(error),
            Self::Locked { error, .. } => Some(error),
            _ => None,
        }
    }
}

/// Whether an id is a usable URL path segment: 1–64 characters of lowercase
/// ASCII alphanumerics and hyphens, not starting or ending with a hyphen.
#[must_use]
pub fn is_valid_vault_id(id: &str) -> bool {
    let len = id.chars().count();
    if !(1..=64).contains(&len) {
        return false;
    }
    let first_ok = id
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    let last_ok = id
        .chars()
        .next_back()
        .is_some_and(|c| c.is_ascii_lowercase() || c.is_ascii_digit());
    first_ok
        && last_ok
        && id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
}

/// Lexically normalizes a path without touching the filesystem: `.` and `..`
/// are folded, and nothing is resolved through symbolic links.
///
/// This is the same stance [`crate::server::resolve_vault_path`] takes: a
/// symlinked root is the scanner's refusal to make, not this module's to
/// quietly overturn by canonicalising it away.
#[must_use]
pub fn normalize_lexically(path: &Path) -> PathBuf {
    let mut parts: Vec<std::ffi::OsString> = Vec::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                // A `..` above the root has nowhere to go; the root keeps it,
                // exactly like `Path::canonicalize` would.
                if parts.pop().is_none() && !path.is_absolute() {
                    parts.push("..".into());
                }
            }
            other => parts.push(other.as_os_str().to_owned()),
        }
    }
    let mut normalized = PathBuf::new();
    for part in parts {
        normalized.push(part);
    }
    if normalized.as_os_str().is_empty() {
        normalized.push(".");
    }
    normalized
}

/// Whether one normalized root contains another (or is equal to it).
fn contains(outer: &Path, inner: &Path) -> bool {
    inner.starts_with(outer)
}

/// The configured set, before opening.
///
/// # Errors
///
/// Returns the first configuration mistake found: an unusable id, a duplicate
/// id, an empty set, or two roots where one contains the other.
pub fn validate(specs: &[VaultSpec]) -> Result<(), RegistryError> {
    if specs.is_empty() {
        return Err(RegistryError::Empty);
    }

    for spec in specs {
        if !is_valid_vault_id(&spec.id) {
            return Err(RegistryError::InvalidId {
                id: spec.id.clone(),
            });
        }
    }

    let mut seen = HashSet::new();
    for spec in specs {
        if !seen.insert(spec.id.clone()) {
            return Err(RegistryError::DuplicateId {
                id: spec.id.clone(),
            });
        }
    }

    // Lexical, not canonical: see the module documentation.
    let mut normalized: Vec<(PathBuf, &VaultSpec)> = specs
        .iter()
        .map(|spec| (normalize_lexically(&spec.path), spec))
        .collect();
    normalized.sort_by(|a, b| a.0.cmp(&b.0));

    for pair in normalized.windows(2) {
        let (outer_path, outer) = &pair[0];
        let (inner_path, inner) = &pair[1];
        if contains(outer_path, inner_path) {
            // Equal paths report as overlapping too: two Vaults on one root
            // is the tightest overlap there is.
            return Err(RegistryError::OverlappingRoots {
                outer: outer.path.clone(),
                inner: inner.path.clone(),
            });
        }
    }

    Ok(())
}

/// One hosted Vault, holding the lock that makes it hostable.
#[derive(Debug)]
pub struct HostedVault {
    /// The configured id, unique within this daemon.
    pub id: String,
    /// The open Vault.
    pub vault: Arc<Vault>,
    /// Dropped when the host is dropped; this is what other processes see.
    _lock: VaultLock,
}

impl HostedVault {
    /// The Vault's display name: its root folder's title when the scan has
    /// one, and the configured id otherwise.
    #[must_use]
    pub fn name(&self) -> String {
        let snapshot = self.vault.snapshot();
        let title = snapshot.scan.folder().title().trim();
        if title.is_empty() {
            self.id.clone()
        } else {
            title.to_owned()
        }
    }
}

/// All the Vaults one daemon hosts.
///
/// Holding one of these means holding every Vault's lock. Dropping it releases
/// them, so a failed startup cannot leak a claim into the next attempt.
#[derive(Debug)]
pub struct VaultRegistry {
    vaults: Vec<HostedVault>,
}

impl VaultRegistry {
    /// Validates the configured set and opens every Vault, or none of them.
    ///
    /// # Errors
    ///
    /// [`RegistryError`] for a configuration mistake, or for the first Vault
    /// that cannot be opened — in which case the Vaults already opened have
    /// been released again. Startup is atomic.
    pub fn open(specs: &[VaultSpec]) -> Result<Self, RegistryError> {
        validate(specs)?;

        let mut vaults: Vec<HostedVault> = Vec::with_capacity(specs.len());
        for spec in specs {
            match open_one(spec) {
                Ok(hosted) => vaults.push(hosted),
                Err(error) => {
                    // Drop what opened: `VaultLock` releases on drop, so the
                    // process holds nothing from this failed attempt.
                    drop(vaults);
                    return Err(error);
                }
            }
        }
        Ok(Self { vaults })
    }

    /// Every hosted Vault, in configuration order.
    pub fn all(&self) -> impl Iterator<Item = &HostedVault> {
        self.vaults.iter()
    }

    /// How many Vaults are hosted.
    #[must_use]
    pub fn len(&self) -> usize {
        self.vaults.len()
    }

    /// Whether no Vault is hosted.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.vaults.is_empty()
    }

    /// The one Vault by its id.
    #[must_use]
    pub fn by_id(&self, id: &str) -> Option<&HostedVault> {
        self.vaults.iter().find(|hosted| hosted.id == id)
    }

    /// The sole Vault when exactly one is hosted.
    #[must_use]
    pub fn sole(&self) -> Option<&HostedVault> {
        match self.vaults.as_slice() {
            [only] => Some(only),
            _ => None,
        }
    }
}

/// Opens one configured Vault: lock, recover, scan.
fn open_one(spec: &VaultSpec) -> Result<HostedVault, RegistryError> {
    let root = fsx::open_root(&spec.path).map_err(|error| RegistryError::Open {
        id: spec.id.clone(),
        path: spec.path.clone(),
        error,
    })?;

    let (lock, state) = VaultLock::acquire(&root, &spec.path).map_err(|error| match error {
        held @ LockError::Held { .. } => RegistryError::Locked {
            id: spec.id.clone(),
            error: held,
        },
        LockError::Io { path, error } => RegistryError::Open {
            id: spec.id.clone(),
            path,
            error,
        },
    })?;

    // The lock is held, so anything left in staging belongs to a run that is
    // no longer alive. Each interrupted operation is finished or undone
    // according to its own manifest; nothing is ever discarded.
    let notices = staging::recover(&state, &root);
    for notice in &notices {
        tracing::error!(
            directory = %notice.directory,
            operation = %notice.operation,
            "entries from an interrupted change were kept and need attention"
        );
    }

    let vault = Vault::open_with_state(&spec.path, state, notices).map_err(|error| {
        RegistryError::Open {
            id: spec.id.clone(),
            path: spec.path.clone(),
            error,
        }
    })?;
    if vault.snapshot().scan.folder().id().is_none() {
        return Err(RegistryError::NotAVault {
            id: spec.id.clone(),
            path: spec.path.clone(),
        });
    }

    Ok(HostedVault {
        id: spec.id.clone(),
        vault: Arc::new(vault),
        _lock: lock,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_must_be_slugs() {
        for id in ["main", "reading-list", "vault2", "a"] {
            assert!(is_valid_vault_id(id), "{id} must be accepted");
        }
        for id in [
            "",
            "-lead",
            "trail-",
            "Upper",
            "with space",
            "with_underscore",
            "slash/id",
            "ünïcode",
            &"x".repeat(65),
        ] {
            assert!(!is_valid_vault_id(id), "{id} must be refused");
        }
    }

    #[test]
    fn normalization_folds_dots_without_touching_links() {
        assert_eq!(
            normalize_lexically(Path::new("/a/./b/../c")),
            PathBuf::from("/a/c")
        );
        assert_eq!(
            normalize_lexically(Path::new("a/link/../b")),
            PathBuf::from("a/b"),
            "a symlinked segment is folded lexically, never resolved"
        );
    }

    #[test]
    fn duplicate_ids_are_refused() {
        let error = validate(&[
            VaultSpec::new("main", "/tmp/one"),
            VaultSpec::new("main", "/tmp/two"),
        ])
        .expect_err("duplicate ids");
        assert!(matches!(error, RegistryError::DuplicateId { .. }));
    }

    #[test]
    fn ancestor_and_equal_roots_are_refused() {
        for (a, b) in [
            ("/tmp/vaults", "/tmp/vaults/inner"),
            ("/tmp/vaults/./inner", "/tmp/vaults/inner/../inner"),
            ("/tmp/vaults", "/tmp/vaults"),
        ] {
            let error = validate(&[VaultSpec::new("a", a), VaultSpec::new("b", b)])
                .expect_err("roots must not overlap");
            assert!(
                matches!(error, RegistryError::OverlappingRoots { .. }),
                "{a} vs {b}: {error}"
            );
        }
    }

    #[test]
    fn sibling_roots_are_accepted() {
        // Component-wise, not string-wise: `vaults-archive` does not start
        // with the *component* `vaults`, so these are siblings.
        validate(&[
            VaultSpec::new("main", "/tmp/vaults"),
            VaultSpec::new("archive", "/tmp/vaults-archive"),
            VaultSpec::new("deep", "/tmp/elsewhere/deep"),
        ])
        .expect("siblings do not overlap");
    }

    #[test]
    fn deep_descendants_are_also_refused() {
        let error = validate(&[
            VaultSpec::new("main", "/tmp/vaults"),
            VaultSpec::new("inner", "/tmp/vaults/a/b/c"),
        ])
        .expect_err("a descendant root overlaps its ancestor");
        assert!(matches!(error, RegistryError::OverlappingRoots { .. }));
    }

    #[test]
    fn an_empty_set_is_refused() {
        assert!(matches!(validate(&[]), Err(RegistryError::Empty)));
    }

    #[test]
    fn vault_arguments_parse() {
        assert_eq!(
            VaultSpec::parse("reading-list=/tmp/reading"),
            Ok(VaultSpec::new("reading-list", "/tmp/reading"))
        );
        assert_eq!(
            VaultSpec::parse("/tmp/plain"),
            Ok(VaultSpec::new(DEFAULT_VAULT_ID, "/tmp/plain"))
        );
        assert_eq!(
            VaultSpec::parse(" =/tmp/spaced "),
            Ok(VaultSpec::new("", "/tmp/spaced")),
            "parsing is lenient; validation refuses the id"
        );
        assert!(VaultSpec::parse("").is_err());
    }
}
