//! The **Bookmarks But Better** daemon: an HTTP API and static web host over
//! one or more Markdown vaults, plus the CLI that drives it.
//!
//! This crate owns *behaviour*. The on-disk format — parsing, scanning,
//! validation and byte-preserving updates — lives entirely in
//! [`bookmarks_but_better_vault_core`] and is never reimplemented here.
//!
//! # What the daemon guarantees
//!
//! * **Only the configured vaults are touched.** Every read, write and watch is
//!   rooted at the directories the user named. Nothing scans elsewhere, and a
//!   directory that is not already a vault is refused rather than initialized
//!   by surprise.
//! * **One writer per vault.** An advisory lock on `<vault>/.bookmarks-but-better/lock` means a second
//!   daemon fails to start instead of racing the first.
//! * **Atomic startup.** The configured set of vaults is validated before
//!   anything opens, and the first vault that cannot be locked, recovered or
//!   scanned fails the whole start-up with everything already taken released
//!   again.
//! * **No silent overwrites.** Every mutation carries the revision the client
//!   last saw; a mismatch is a `409`, never a write. A change to what a folder
//!   holds — or to the order it holds it in — additionally carries that
//!   folder's `stateRevision`.
//! * **One transaction per change.** A create, a delete, a move and a reorder
//!   each record what they are about to do in a durable manifest before doing
//!   it, entries and `.bookmarks-but-better-state.json` writes alike, so an interrupted change is
//!   completed or undone at the next start rather than left half-applied.
//! * **No lost bytes.** Updates go through the format core's surgical patching,
//!   and land through a temporary file in the destination directory that is
//!   fsynced and renamed into place.
//! * **Stable identities.** Identity lives in front matter, so it survives
//!   moves, renames and restarts.
//! * **Loopback only.** The daemon binds a loopback address and additionally
//!   refuses any request whose `Host` is not a loopback name.
//!
//! # Layout
//!
//! ```text
//! cli      the subcommands
//! server   registry + router + watchers + shutdown
//! registry the hosted set of vaults: validation, atomic open, discovery ids
//! api      the /api/v1 routes, unscoped and vault-scoped
//! vault    the cached scan, the generation, and every mutation
//! fsx      handle-relative, no-follow filesystem primitives
//! staging  reversible deletion
//! subtree  proving a folder is safe to delete before deleting it
//! init     making a directory into a vault
//! doctor   the read-only health report
//! watch    debounced, content-checked reconciliation
//! ```
//!
//! # Example
//!
//! ```no_run
//! # async fn example() -> Result<(), Box<dyn std::error::Error>> {
//! use bookmarks_but_better::{Daemon, ServeOptions};
//!
//! let options = ServeOptions::new("/home/user/bookmarks");
//! let daemon = Daemon::open(&options)?;
//! let listener = bookmarks_but_better::server::bind(&options).await?;
//! daemon
//!     .serve(listener, async { /* shutdown signal */ }, Default::default())
//!     .await?;
//! # Ok(())
//! # }
//! ```

// Denied rather than forbidden so that `fsx::platform` — the single module
// holding this crate's FFI — can allow it. Nothing else may.
#![deny(unsafe_code)]

mod clock;
mod extract;
mod fsx;
mod host;
mod staging;
mod subtree;
mod ui;

pub mod api;
pub mod cli;
pub mod doctor;
pub mod dto;
pub mod entry;
pub mod init;
pub mod lock;
pub mod problem;
pub mod registry;
pub mod server;
pub mod service;
pub mod setup;
pub mod vault;
pub mod watch;

pub use crate::entry::EntryRef;
pub use crate::init::{InitOutcome, initialize};
pub use crate::lock::VaultLock;
pub use crate::problem::{Problem, ProblemCode};
pub use crate::registry::{DEFAULT_VAULT_ID, HostedVault, VaultRegistry, VaultSpec};
pub use crate::server::{Daemon, ServeOptions, StartError};
pub use crate::vault::Vault;

/// The daemon's version, as reported by `GET /api/v1/health`.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
