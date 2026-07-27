//! The `bbb` binary.
//!
//! Everything of substance lives in the library so that the integration tests
//! can build a router against a temporary vault without spawning a process.

#![forbid(unsafe_code)]

use std::process::ExitCode;

use clap::Parser as _;

fn main() -> ExitCode {
    bbb::cli::Cli::parse().run()
}
