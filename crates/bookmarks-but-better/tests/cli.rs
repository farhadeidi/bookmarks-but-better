//! The command line, driven as a user drives it.

use std::path::Path;
use std::process::{Command, Output};

/// Runs the real `bookmarks-but-better` binary with `args`.
fn bookmarks_but_better(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_bookmarks-but-better"))
        .args(args)
        .output()
        .expect("run bookmarks-but-better")
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

    let first = bookmarks_but_better(&["init", "--vault", &vault]);
    assert!(first.status.success(), "{}", stderr(&first));
    assert!(
        stdout(&first).contains("initialized vault"),
        "{}",
        stdout(&first)
    );
    assert!(
        directory
            .path()
            .join(".bookmarks-but-better-folder.md")
            .is_file()
    );

    let second = bookmarks_but_better(&["init", "--vault", &vault]);
    assert!(second.status.success(), "{}", stderr(&second));
    assert!(
        stdout(&second).contains("already initialized"),
        "{}",
        stdout(&second)
    );
}

#[test]
fn init_creates_a_missing_vault_directory_but_not_missing_parents() {
    let parent = tempfile::tempdir().expect("temp dir");
    let missing = parent.path().join("Bookmarks");
    let missing_arg = vault_arg(&missing);

    let created = bookmarks_but_better(&["init", "--vault", &missing_arg]);
    assert!(created.status.success(), "{}", stderr(&created));
    assert!(missing.join(".bookmarks-but-better-folder.md").is_file());

    let nested = parent.path().join("missing-parent").join("Bookmarks");
    let nested_arg = vault_arg(&nested);
    let refused = bookmarks_but_better(&["init", "--vault", &nested_arg]);
    assert!(!refused.status.success(), "{}", stdout(&refused));
    assert!(!parent.path().join("missing-parent").exists());
}

#[test]
fn doctor_fails_on_an_uninitialized_directory_and_passes_on_a_vault() {
    let directory = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(directory.path());

    let before = bookmarks_but_better(&["doctor", "--vault", &vault]);
    assert!(
        !before.status.success(),
        "an uninitialized directory is not healthy: {}",
        stdout(&before)
    );
    assert!(stdout(&before).contains("MISSING"), "{}", stdout(&before));
    assert!(
        stdout(&before).contains("bookmarks-but-better init --vault"),
        "the report says how to fix it: {}",
        stdout(&before)
    );

    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );

    let after = bookmarks_but_better(&["doctor", "--vault", &vault]);
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
    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );

    // A bookmark with no URL parses, but cannot be written.
    std::fs::write(
        directory.path().join("Broken--aaaabbbb.md"),
        "---\nbookmarks_but_better_id: aaaabbbb\nbookmarks_but_better_url:\nbookmarks_but_better_title: Broken\n\
         bookmarks_but_better_created: 2026-01-01T00:00:00Z\nbookmarks_but_better_updated: 2026-01-01T00:00:00Z\n---\n",
    )
    .expect("write");

    let output = bookmarks_but_better(&["doctor", "--vault", &vault]);
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
    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );
    std::fs::write(
        directory.path().join("Notes--11112222.md"),
        "---\nbookmarks_but_better_id: 11112222\nbookmarks_but_better_url: https://example.com\nbookmarks_but_better_title: Notes\n\
         bookmarks_but_better_created: 2026-01-01T00:00:00Z\nbookmarks_but_better_updated: 2026-01-01T00:00:00Z\n---\n",
    )
    .expect("write");
    let before = std::fs::read(directory.path().join("Notes--11112222.md")).expect("read");

    let output = bookmarks_but_better(&["rescan", "--vault", &vault]);
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

    let output = bookmarks_but_better(&["serve", "--vault", &vault, "--port", "0"]);
    assert!(!output.status.success());
    let message = stderr(&output);
    assert!(message.contains("not an initialized vault"), "{message}");
    assert!(
        message.contains("bookmarks-but-better init --vault"),
        "{message}"
    );
    assert!(
        !directory
            .path()
            .join(".bookmarks-but-better-folder.md")
            .exists(),
        "a refused serve must not write into the directory"
    );
}

#[test]
fn serve_refuses_a_non_loopback_bind() {
    let directory = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(directory.path());
    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );

    let output = bookmarks_but_better(&[
        "serve", "--vault", &vault, "--bind", "0.0.0.0", "--port", "0",
    ]);
    assert!(!output.status.success());
    assert!(stderr(&output).contains("loopback"), "{}", stderr(&output));
}

#[test]
fn the_help_text_documents_every_subcommand() {
    let output = bookmarks_but_better(&["--help"]);
    assert!(output.status.success(), "{}", stderr(&output));
    let help = stdout(&output);
    for command in ["serve", "init", "doctor", "rescan"] {
        assert!(
            help.contains(command),
            "`{command}` is missing from: {help}"
        );
    }
}

#[test]
fn serve_documents_the_new_default_port_and_still_accepts_an_explicit_one() {
    let help = stdout(&bookmarks_but_better(&["serve", "--help"]));
    assert!(
        help.contains("52222"),
        "the default port is documented: {help}"
    );
    assert!(
        !help.contains("47321"),
        "the previous default is not offered as a second listener: {help}"
    );

    // The old default is an ordinary port value, so an installation configured
    // on it keeps starting after an upgrade.
    let directory = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(directory.path());
    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );

    let output = bookmarks_but_better(&[
        "serve", "--vault", &vault, "--bind", "0.0.0.0", "--port", "47321",
    ]);
    // Refused for the bind, not for the port: the port was accepted and parsed.
    assert!(!output.status.success());
    assert!(stderr(&output).contains("loopback"), "{}", stderr(&output));
}

/// Runs `bookmarks-but-better` with `HOME` and `XDG_CONFIG_HOME` pointed at a temporary
/// directory, so a service test installs into it rather than into whatever
/// machine the suite runs on.
fn bookmarks_but_better_in_home(home: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_bookmarks-but-better"))
        .args(args)
        .env("HOME", home)
        .env("XDG_CONFIG_HOME", home.join(".config"))
        .env("USERPROFILE", home)
        // Without a session bus there is no usable `systemctl --user`, so the
        // CLI takes the XDG autostart fallback and never shells out.
        .env_remove("XDG_RUNTIME_DIR")
        .output()
        .expect("run bookmarks-but-better")
}

/// Where the selected platform service kind puts its definition.
fn definition_path(home: &Path) -> std::path::PathBuf {
    if cfg!(target_os = "macos") {
        home.join("Library")
            .join("LaunchAgents")
            .join("com.farhadeidi.bookmarks.plist")
    } else if cfg!(windows) {
        home.join(".config")
            .join("bookmarks-but-better")
            .join("bookmarks-but-better-task.xml")
    } else {
        home.join(".config")
            .join("autostart")
            .join("bookmarks-but-better.desktop")
    }
}

fn definition_text(path: &Path) -> String {
    let bytes = std::fs::read(path).expect("read definition");
    if cfg!(windows) {
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]));
        String::from_utf16(&units.collect::<Vec<_>>()).expect("UTF-16 definition")
    } else {
        String::from_utf8(bytes).expect("UTF-8 definition")
    }
}

#[test]
fn service_install_writes_a_definition_naming_the_vault_and_is_idempotent() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );

    let first = bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--vault", &vault, "--no-start"],
    );
    assert!(first.status.success(), "{}", stderr(&first));

    let entry = definition_path(home.path());
    assert!(entry.is_file(), "{}", stdout(&first));
    let text = definition_text(&entry);
    assert!(text.contains("127.0.0.1"), "{text}");
    assert!(text.contains("52222"), "{text}");

    // Installing the same thing again writes nothing.
    let before = std::fs::read(&entry).expect("read");
    let second = bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--vault", &vault, "--no-start"],
    );
    assert!(second.status.success(), "{}", stderr(&second));
    assert!(stdout(&second).contains("unchanged"), "{}", stdout(&second));
    assert_eq!(std::fs::read(&entry).expect("read"), before);
}

#[test]
fn service_install_preserves_an_explicit_port_across_an_upgrade() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );

    // An installation configured on the previous default.
    let installed = bookmarks_but_better_in_home(
        home.path(),
        &[
            "service",
            "install",
            "--vault",
            &vault,
            "--port",
            "47321",
            "--no-start",
        ],
    );
    assert!(installed.status.success(), "{}", stderr(&installed));

    // An upgrade that names no port must not move it to the new default.
    let upgraded = bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--vault", &vault, "--no-start"],
    );
    assert!(upgraded.status.success(), "{}", stderr(&upgraded));
    assert!(
        stdout(&upgraded).contains("keeping the installed port 47321"),
        "{}",
        stdout(&upgraded)
    );

    let text = definition_text(&definition_path(home.path()));
    assert!(text.contains("47321"), "{text}");
    assert!(!text.contains("52222"), "{text}");

    // And a named port is still obeyed.
    let moved = bookmarks_but_better_in_home(
        home.path(),
        &[
            "service",
            "install",
            "--vault",
            &vault,
            "--port",
            "40404",
            "--no-start",
        ],
    );
    assert!(moved.status.success(), "{}", stderr(&moved));
    let text = definition_text(&definition_path(home.path()));
    assert!(text.contains("40404"), "{text}");
}

#[test]
fn service_status_reports_what_is_installed_and_uninstall_never_touches_the_vault() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );

    let absent = bookmarks_but_better_in_home(home.path(), &["service", "status"]);
    assert!(absent.status.success(), "{}", stderr(&absent));
    assert!(
        stdout(&absent).contains("not installed"),
        "{}",
        stdout(&absent)
    );

    bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--vault", &vault, "--no-start"],
    );

    let present = bookmarks_but_better_in_home(home.path(), &["service", "status"]);
    let report = stdout(&present);
    assert!(report.contains(&vault), "the vault is reported: {report}");
    assert!(report.contains("52222"), "the port is reported: {report}");

    // A marker file proving the vault survives as *content*, not just as a
    // directory entry.
    let bookmark = vault_dir.path().join("Notes--11112222.md");
    std::fs::write(&bookmark, "---\nbookmarks_but_better_id: 11112222\n---\n").expect("write");

    let removed = bookmarks_but_better_in_home(home.path(), &["service", "uninstall"]);
    assert!(removed.status.success(), "{}", stderr(&removed));
    assert!(!definition_path(home.path()).exists());
    assert!(
        vault_dir
            .path()
            .join(".bookmarks-but-better-folder.md")
            .is_file(),
        "uninstall must never delete the vault"
    );
    assert!(bookmark.is_file(), "nor anything in it");

    // Uninstalling again is not an error.
    let again = bookmarks_but_better_in_home(home.path(), &["service", "uninstall"]);
    assert!(again.status.success(), "{}", stderr(&again));
    assert!(
        stdout(&again).contains("nothing to remove"),
        "{}",
        stdout(&again)
    );
}

#[test]
fn service_install_quotes_a_vault_path_with_spaces_and_unicode() {
    let home = tempfile::tempdir().expect("temp dir");
    let parent = tempfile::tempdir().expect("temp dir");
    let awkward = parent.path().join("My Bookmarks 书签");
    std::fs::create_dir_all(&awkward).expect("create vault dir");
    let vault = vault_arg(&awkward);
    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );

    let installed = bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--vault", &vault, "--no-start"],
    );
    assert!(installed.status.success(), "{}", stderr(&installed));

    // The path survives the round trip through the definition file, which is
    // what `status` reads back.
    let report = stdout(&bookmarks_but_better_in_home(
        home.path(),
        &["service", "status"],
    ));
    assert!(
        report.contains("My Bookmarks 书签"),
        "the awkward path round-trips: {report}"
    );
}

#[test]
fn the_help_text_documents_setup_and_service() {
    let help = stdout(&bookmarks_but_better(&["--help"]));
    for command in ["setup", "service"] {
        assert!(
            help.contains(command),
            "`{command}` is missing from: {help}"
        );
    }

    let service = stdout(&bookmarks_but_better(&["service", "--help"]));
    for command in ["install", "start", "stop", "status", "uninstall"] {
        assert!(
            service.contains(command),
            "`{command}` is missing from: {service}"
        );
    }
}
