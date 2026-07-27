//! The command line, driven as a user drives it.

use std::path::Path;
use std::process::{Command, Output};

/// Runs the real `bbb` binary with `args`.
fn bbb(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_bbb"))
        .args(args)
        .output()
        .expect("run bbb")
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn vault_arg(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[test]
fn init_creates_the_root_metadata_and_is_idempotent() {
    let directory = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(directory.path());

    let first = bbb(&["init", "--vault", &vault]);
    assert!(first.status.success(), "{}", stderr(&first));
    assert!(
        stdout(&first).contains("initialized vault"),
        "{}",
        stdout(&first)
    );
    assert!(directory.path().join(".bbb-folder.md").is_file());

    let second = bbb(&["init", "--vault", &vault]);
    assert!(second.status.success(), "{}", stderr(&second));
    assert!(
        stdout(&second).contains("already initialized"),
        "{}",
        stdout(&second)
    );
}

#[test]
fn doctor_fails_on_an_uninitialized_directory_and_passes_on_a_vault() {
    let directory = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(directory.path());

    let before = bbb(&["doctor", "--vault", &vault]);
    assert!(
        !before.status.success(),
        "an uninitialized directory is not healthy: {}",
        stdout(&before)
    );
    assert!(stdout(&before).contains("MISSING"), "{}", stdout(&before));
    assert!(
        stdout(&before).contains("bbb init --vault"),
        "the report says how to fix it: {}",
        stdout(&before)
    );

    assert!(bbb(&["init", "--vault", &vault]).status.success());

    let after = bbb(&["doctor", "--vault", &vault]);
    assert!(after.status.success(), "{}", stdout(&after));
    assert!(
        stdout(&after).contains("the vault is healthy"),
        "{}",
        stdout(&after)
    );
}

#[test]
fn doctor_reports_a_read_only_entry_and_exits_non_zero() {
    let directory = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(directory.path());
    assert!(bbb(&["init", "--vault", &vault]).status.success());

    // A bookmark with no URL parses, but cannot be written.
    std::fs::write(
        directory.path().join("Broken--aaaabbbb.md"),
        "---\nbbb_id: aaaabbbb\nbbb_url:\nbbb_title: Broken\n\
         bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\n",
    )
    .expect("write");

    let output = bbb(&["doctor", "--vault", &vault]);
    assert!(!output.status.success(), "{}", stdout(&output));
    let report = stdout(&output);
    assert!(report.contains("empty_url"), "{report}");
    assert!(report.contains("Broken--aaaabbbb.md"), "{report}");
    assert!(report.contains("require attention"), "{report}");
}

#[test]
fn rescan_reports_what_the_vault_holds_without_changing_it() {
    let directory = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(directory.path());
    assert!(bbb(&["init", "--vault", &vault]).status.success());
    std::fs::write(
        directory.path().join("Notes--11112222.md"),
        "---\nbbb_id: 11112222\nbbb_url: https://example.com\nbbb_title: Notes\n\
         bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\n",
    )
    .expect("write");
    let before = std::fs::read(directory.path().join("Notes--11112222.md")).expect("read");

    let output = bbb(&["rescan", "--vault", &vault]);
    assert!(output.status.success(), "{}", stderr(&output));
    let report = stdout(&output);
    assert!(report.contains("bookmarks   1"), "{report}");

    assert_eq!(
        std::fs::read(directory.path().join("Notes--11112222.md")).expect("read"),
        before,
        "a rescan never writes"
    );
}

#[test]
fn serve_refuses_a_directory_that_is_not_a_vault() {
    let directory = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(directory.path());

    let output = bbb(&["serve", "--vault", &vault, "--port", "0"]);
    assert!(!output.status.success());
    let message = stderr(&output);
    assert!(message.contains("not an initialized vault"), "{message}");
    assert!(message.contains("bbb init --vault"), "{message}");
    assert!(
        !directory.path().join(".bbb-folder.md").exists(),
        "a refused serve must not write into the directory"
    );
}

#[test]
fn serve_refuses_a_non_loopback_bind() {
    let directory = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(directory.path());
    assert!(bbb(&["init", "--vault", &vault]).status.success());

    let output = bbb(&[
        "serve", "--vault", &vault, "--bind", "0.0.0.0", "--port", "0",
    ]);
    assert!(!output.status.success());
    assert!(stderr(&output).contains("loopback"), "{}", stderr(&output));
}

#[test]
fn the_help_text_documents_every_subcommand() {
    let output = bbb(&["--help"]);
    assert!(output.status.success(), "{}", stderr(&output));
    let help = stdout(&output);
    for command in ["serve", "init", "doctor", "rescan"] {
        assert!(
            help.contains(command),
            "`{command}` is missing from: {help}"
        );
    }
}
