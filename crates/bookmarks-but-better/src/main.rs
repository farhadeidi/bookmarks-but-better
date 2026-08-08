//! The `bookmarks-but-better` binary.
//!
//! Everything of substance lives in the library so that the integration tests
//! can build a router against a temporary vault without spawning a process.

#![deny(unsafe_code)]

use std::process::ExitCode;

use clap::Parser as _;

fn main() -> ExitCode {
    bookmarks_but_better::cli::Cli::parse().run()
}
