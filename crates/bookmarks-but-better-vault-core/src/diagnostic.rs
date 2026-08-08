//! Diagnostics reported for vault content the daemon cannot fully trust.
//!
//! A diagnostic is always actionable: it names a file, usually names a line, and
//! says what has to change. [`Severity::Error`] means the entry is read-only
//! until a human fixes it; [`Severity::Warning`] means the entry still works but
//! something about it is not canonical.

use core::fmt;

/// How badly a diagnostic affects the entry it belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub enum Severity {
    /// The entry is usable and writable; something is merely not canonical.
    Warning,
    /// The entry cannot be written safely and is exposed read-only.
    Error,
}

impl Severity {
    /// A stable machine-readable name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

impl fmt::Display for Severity {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// A stable identifier for a class of vault problem.
///
/// Codes are part of the API contract: transports serialise them and clients
/// branch on them, so they are never renamed or reused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum DiagnosticCode {
    /// The file is not valid UTF-8.
    InvalidUtf8,
    /// Front matter opened with `---` but was never closed.
    UnterminatedFrontmatter,
    /// A managed file has no front matter at all.
    MissingFrontmatter,
    /// Front matter is not a mapping of keys to values.
    NonMappingRoot,
    /// Front matter is not valid YAML.
    MalformedYaml,
    /// Front matter holds more than one YAML document.
    MultipleDocuments,
    /// An owned `bookmarks_but_better_*` key appears more than once.
    DuplicateOwnedKey,
    /// A key appears more than once, which is invalid YAML and ambiguous.
    DuplicateKey,
    /// An owned key holds a value outside the supported single-line subset.
    UnsupportedValue,
    /// `bookmarks_but_better_id` is missing or is not a valid identity.
    InvalidId,
    /// A required owned key is absent.
    MissingRequiredField,
    /// `bookmarks_but_better_url` is present but empty.
    EmptyUrl,
    /// A timestamp is not RFC 3339.
    InvalidTimestamp,
    /// The `--<id>` suffix of the filename disagrees with `bookmarks_but_better_id`.
    FilenameIdMismatch,
    /// Two entries in the vault claim the same identity.
    DuplicateId,
    /// An unrecognised key uses the reserved `bookmarks_but_better_` namespace.
    ReservedKeyUnknown,
    /// A directory has no `.bookmarks-but-better-folder.md`, so it has no stable identity.
    MissingFolderMetadata,
    /// A path was skipped because it is a symbolic link.
    SymlinkSkipped,
    /// A file was skipped because it is larger than the configured limit.
    FileTooLarge,
    /// A directory was not descended into because the depth limit was reached.
    MaxDepthExceeded,
    /// A path could not be read.
    UnreadablePath,
    /// A name does not survive being copied to another platform.
    NonPortableName,
    /// The folder's `.bookmarks-but-better-state.json` could not be read at all.
    StateUnreadable,
    /// The folder's `.bookmarks-but-better-state.json` is not the JSON the schema defines.
    StateMalformed,
    /// The folder's `.bookmarks-but-better-state.json` declares an unknown schema version.
    StateUnsupportedVersion,
    /// The folder's `.bookmarks-but-better-state.json` holds something this build must not
    /// rewrite: an unknown key, or one identity listed twice.
    StateNotRewritable,
    /// The state names a child as one kind and the directory holds the other.
    StateWrongKind,
    /// The state names a child the directory does not hold.
    StateMissingChild,
}

impl DiagnosticCode {
    /// A stable machine-readable name.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::InvalidUtf8 => "invalid_utf8",
            Self::UnterminatedFrontmatter => "unterminated_frontmatter",
            Self::MissingFrontmatter => "missing_frontmatter",
            Self::NonMappingRoot => "non_mapping_root",
            Self::MalformedYaml => "malformed_yaml",
            Self::MultipleDocuments => "multiple_documents",
            Self::DuplicateOwnedKey => "duplicate_owned_key",
            Self::DuplicateKey => "duplicate_key",
            Self::UnsupportedValue => "unsupported_value",
            Self::InvalidId => "invalid_id",
            Self::MissingRequiredField => "missing_required_field",
            Self::EmptyUrl => "empty_url",
            Self::InvalidTimestamp => "invalid_timestamp",
            Self::FilenameIdMismatch => "filename_id_mismatch",
            Self::DuplicateId => "duplicate_id",
            Self::ReservedKeyUnknown => "reserved_key_unknown",
            Self::MissingFolderMetadata => "missing_folder_metadata",
            Self::SymlinkSkipped => "symlink_skipped",
            Self::FileTooLarge => "file_too_large",
            Self::MaxDepthExceeded => "max_depth_exceeded",
            Self::UnreadablePath => "unreadable_path",
            Self::NonPortableName => "non_portable_name",
            Self::StateUnreadable => "state_unreadable",
            Self::StateMalformed => "state_malformed",
            Self::StateUnsupportedVersion => "state_unsupported_version",
            Self::StateNotRewritable => "state_not_rewritable",
            Self::StateWrongKind => "state_wrong_kind",
            Self::StateMissingChild => "state_missing_child",
        }
    }

    /// The severity this class of problem always carries.
    ///
    /// Severity is a property of the code rather than of the call site, so that
    /// the same problem never renders as read-only in one place and writable in
    /// another.
    ///
    /// Every `state_*` code is a warning, and deliberately so. A child order
    /// file the daemon cannot rewrite says nothing about the folder's identity
    /// or about the bookmarks inside it: renaming, creating and deleting all
    /// remain perfectly safe, and only *positional* changes have to be refused.
    /// Making these errors would take the whole folder read-only over a file
    /// that holds no user content at all. What actually blocks a reorder is
    /// [`crate::StateAccess`], which the scan reports separately.
    #[must_use]
    pub const fn severity(self) -> Severity {
        match self {
            Self::InvalidUtf8
            | Self::UnterminatedFrontmatter
            | Self::MissingFrontmatter
            | Self::NonMappingRoot
            | Self::MalformedYaml
            | Self::MultipleDocuments
            | Self::DuplicateKey
            | Self::DuplicateOwnedKey
            | Self::UnsupportedValue
            | Self::InvalidId
            | Self::EmptyUrl
            | Self::DuplicateId
            | Self::FileTooLarge
            | Self::UnreadablePath => Severity::Error,
            Self::MissingRequiredField
            | Self::InvalidTimestamp
            | Self::FilenameIdMismatch
            | Self::ReservedKeyUnknown
            | Self::MissingFolderMetadata
            | Self::SymlinkSkipped
            | Self::MaxDepthExceeded
            | Self::NonPortableName
            | Self::StateUnreadable
            | Self::StateMalformed
            | Self::StateUnsupportedVersion
            | Self::StateNotRewritable
            | Self::StateWrongKind
            | Self::StateMissingChild => Severity::Warning,
        }
    }
}

impl fmt::Display for DiagnosticCode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

/// One problem found in the vault.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Diagnostic {
    code: DiagnosticCode,
    path: Option<String>,
    line: Option<usize>,
    detail: String,
}

impl Diagnostic {
    /// Creates a diagnostic that is not tied to a path.
    #[must_use]
    pub fn new(code: DiagnosticCode, detail: impl Into<String>) -> Self {
        Self {
            code,
            path: None,
            line: None,
            detail: detail.into(),
        }
    }

    /// Attaches the vault-relative path the problem was found at.
    #[must_use]
    pub fn at_path(mut self, path: impl Into<String>) -> Self {
        self.path = Some(path.into());
        self
    }

    /// Attaches the 1-based line the problem was found on.
    #[must_use]
    pub fn at_line(mut self, line: usize) -> Self {
        self.line = Some(line);
        self
    }

    /// The stable code for this problem.
    #[must_use]
    pub const fn code(&self) -> DiagnosticCode {
        self.code
    }

    /// Whether the entry remains writable.
    #[must_use]
    pub const fn severity(&self) -> Severity {
        self.code.severity()
    }

    /// The vault-relative, `/`-separated path, when known.
    #[must_use]
    pub fn path(&self) -> Option<&str> {
        self.path.as_deref()
    }

    /// The 1-based line, when known.
    #[must_use]
    pub const fn line(&self) -> Option<usize> {
        self.line
    }

    /// The human-readable explanation.
    #[must_use]
    pub fn detail(&self) -> &str {
        &self.detail
    }
}

impl fmt::Display for Diagnostic {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.detail)?;
        match (&self.path, self.line) {
            (Some(path), Some(line)) => write!(f, " ({path}:{line})"),
            (Some(path), None) => write!(f, " ({path})"),
            (None, _) => Ok(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Diagnostic, DiagnosticCode, Severity};

    #[test]
    fn codes_are_unique_and_stable() {
        let codes = [
            DiagnosticCode::InvalidUtf8,
            DiagnosticCode::UnterminatedFrontmatter,
            DiagnosticCode::MissingFrontmatter,
            DiagnosticCode::NonMappingRoot,
            DiagnosticCode::MalformedYaml,
            DiagnosticCode::MultipleDocuments,
            DiagnosticCode::DuplicateOwnedKey,
            DiagnosticCode::DuplicateKey,
            DiagnosticCode::UnsupportedValue,
            DiagnosticCode::InvalidId,
            DiagnosticCode::MissingRequiredField,
            DiagnosticCode::EmptyUrl,
            DiagnosticCode::InvalidTimestamp,
            DiagnosticCode::FilenameIdMismatch,
            DiagnosticCode::DuplicateId,
            DiagnosticCode::ReservedKeyUnknown,
            DiagnosticCode::MissingFolderMetadata,
            DiagnosticCode::SymlinkSkipped,
            DiagnosticCode::FileTooLarge,
            DiagnosticCode::MaxDepthExceeded,
            DiagnosticCode::UnreadablePath,
            DiagnosticCode::NonPortableName,
            DiagnosticCode::StateUnreadable,
            DiagnosticCode::StateMalformed,
            DiagnosticCode::StateUnsupportedVersion,
            DiagnosticCode::StateNotRewritable,
            DiagnosticCode::StateWrongKind,
            DiagnosticCode::StateMissingChild,
        ];
        let mut names: Vec<&str> = codes.iter().map(|code| code.as_str()).collect();
        names.sort_unstable();
        let count = names.len();
        names.dedup();
        assert_eq!(names.len(), count);
    }

    #[test]
    fn renders_path_and_line() {
        let diagnostic = Diagnostic::new(
            DiagnosticCode::InvalidId,
            "`bookmarks_but_better_id` is not valid",
        )
        .at_path("notes/React--a1b2c3d4.md")
        .at_line(2);
        assert_eq!(diagnostic.severity(), Severity::Error);
        assert_eq!(
            diagnostic.to_string(),
            "invalid_id: `bookmarks_but_better_id` is not valid (notes/React--a1b2c3d4.md:2)"
        );
    }
}
