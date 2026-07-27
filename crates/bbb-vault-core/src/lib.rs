//! Canonical on-disk vault format for **Bookmarks But Better**.
//!
//! This crate owns the *format*, and nothing else. It has no knowledge of HTTP,
//! the CLI, filesystem watching, background services or networking; those live
//! in separate layers that consume the types defined here.
//!
//! # The format
//!
//! A vault is an ordinary directory tree that stays fully usable in a text
//! editor, in Obsidian, and in Git.
//!
//! * One bookmark is one Markdown file named `<sanitized title>--<id>.md`, for
//!   example `React--a1b2c3d4.md`. The `--<id>` suffix is immutable; the
//!   human-readable part may change freely.
//! * One bookmark folder is one directory. Every managed directory contains a
//!   `.bbb-folder.md` file holding the directory's stable identity.
//! * Identity lives in the YAML front matter, never in the path, so it survives
//!   renames and moves.
//!
//! Owned front matter keys are namespaced with a `bbb_` prefix:
//!
//! | key            | bookmark | folder   | meaning                    |
//! |----------------|----------|----------|----------------------------|
//! | `bbb_id`       | required | required | stable identity            |
//! | `bbb_url`      | required | –        | target URL                 |
//! | `bbb_title`    | required | optional | display title              |
//! | `bbb_created`  | required | –        | RFC 3339 creation time     |
//! | `bbb_updated`  | required | –        | RFC 3339 modification time |
//! | `bbb_logo`     | optional | –        | vault-relative logo path   |
//!
//! Everything else in the file — unknown keys, key order, comments, quoting
//! style, the byte order mark, line endings and the whole Markdown body — is
//! user data. This crate never rewrites it.
//!
//! # Byte preservation
//!
//! Updates are *surgical*: [`BookmarkFile::apply`] locates the byte range of an
//! owned scalar value and splices a new encoding into the original bytes. The
//! document is never deserialized and re-serialized, so a no-op update is
//! byte-identical to its input and unknown bytes cannot be lost.
//!
//! Anything that cannot be updated safely is refused rather than guessed at.
//! Invalid UTF-8, unterminated front matter, a non-mapping root, duplicated
//! owned keys and multiline or collection values for owned keys are all hard
//! parse errors, which [`scan`] reports as read-only entries with actionable
//! diagnostics.
//!
//! # Example
//!
//! ```
//! use bbb_vault_core::{Access, BookmarkFile, BookmarkUpdate};
//!
//! let source = b"---\r\nbbb_id: a1b2c3d4\r\nbbb_url: https://example.com\r\n\
//!                bbb_title: Example\r\nbbb_created: 2026-01-01T00:00:00Z\r\n\
//!                bbb_updated: 2026-01-01T00:00:00Z\r\ntags: [a, b]  # kept\r\n\
//!                ---\r\nBody text.\r\n";
//!
//! let file = BookmarkFile::parse(source)?;
//! assert_eq!(file.access(), Access::ReadWrite);
//! assert_eq!(file.title(), Some("Example"));
//!
//! // A no-op update returns the original bytes untouched.
//! let noop = file.apply(source, &BookmarkUpdate::new().title("Example"))?;
//! assert_eq!(noop, source);
//!
//! // A real update only rewrites the value it was asked to rewrite.
//! let renamed = file.apply(source, &BookmarkUpdate::new().title("Renamed"))?;
//! assert!(String::from_utf8_lossy(&renamed).contains("tags: [a, b]  # kept"));
//! assert!(String::from_utf8_lossy(&renamed).contains("bbb_title: Renamed\r\n"));
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

#![forbid(unsafe_code)]

mod diagnostic;
mod document;
mod hash;
mod id;
mod naming;
mod revision;
mod scan;
mod timestamp;
mod yaml;

pub use crate::diagnostic::{Diagnostic, DiagnosticCode, Severity};
pub use crate::document::{
    Access, BookmarkFile, BookmarkUpdate, FolderFile, FolderUpdate, KEY_CREATED, KEY_ID, KEY_LOGO,
    KEY_TITLE, KEY_UPDATED, KEY_URL, ParseError, UpdateError, render_bookmark, render_folder,
};
pub use crate::id::{ID_ALPHABET, ID_LENGTH, Id, IdError};
pub use crate::naming::{
    MAX_STEM_BYTES, NameAllocator, assets_directory_name, bookmark_file_name, fold_key,
    folder_directory_name, is_reserved_stem, parse_bookmark_file_name, sanitize_title,
};
pub use crate::revision::Revision;
pub use crate::scan::{
    BookmarkNode, FOLDER_FILE_NAME, FolderNode, ScanOptions, VaultScan, scan, scan_with,
};
pub use crate::timestamp::is_rfc3339;
