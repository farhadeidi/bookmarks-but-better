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
    for command in ["serve", "init", "doctor", "rescan", "vault", "service"] {
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
            .join("dev.but-better.bookmarks.plist")
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

/// Before 4.2.0 the agent was named after the domain the project used to have.
/// An upgrade reads it — its vault and its port — and replaces it, leaving
/// only the current definition behind.
#[cfg(target_os = "macos")]
#[test]
fn service_install_retires_the_agent_an_earlier_version_installed() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    assert!(
        bookmarks_but_better(&["init", "--vault", &vault])
            .status
            .success()
    );

    // The shape an earlier version left: a plist under the old file name. Its label is one
    // nothing loads, because retiring boots the agent out by this file and the
    // real old label may belong to a daemon running on this machine.
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
    let current = definition_path(home.path());
    let legacy = current.with_file_name("com.farhadeidi.bookmarks.plist");
    let text = definition_text(&current).replace(
        "<string>dev.but-better.bookmarks</string>",
        "<string>dev.but-better.bookmarks.cli-test</string>",
    );
    std::fs::write(&legacy, text).expect("write the old agent");
    std::fs::remove_file(&current).expect("remove the current agent");

    let status = bookmarks_but_better_in_home(home.path(), &["service", "status"]);
    let report = stdout(&status);
    assert!(!report.contains("not installed"), "{report}");
    assert!(report.contains(&vault), "the vault is reported: {report}");
    assert!(report.contains("47321"), "the port is reported: {report}");

    let upgraded = bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--vault", &vault, "--no-start"],
    );
    let output = stdout(&upgraded);
    assert!(upgraded.status.success(), "{}", stderr(&upgraded));
    assert!(
        output.contains("keeping the installed port 47321"),
        "{output}"
    );
    assert!(!legacy.exists(), "the old agent is gone: {output}");
    assert!(definition_text(&current).contains("47321"), "{output}");
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
fn the_help_text_documents_the_service_commands_and_never_a_setup() {
    let help = stdout(&bookmarks_but_better(&["--help"]));
    assert!(
        help.contains("service"),
        "`service` is missing from: {help}"
    );
    // The guided first run lives in the Daemon Manager (ADR-0006); this binary
    // asks no questions.
    assert!(!help.contains("setup"), "a `setup` command is back: {help}");

    let service = stdout(&bookmarks_but_better(&["service", "--help"]));
    for command in ["install", "start", "stop", "status", "uninstall"] {
        assert!(
            service.contains(command),
            "`{command}` is missing from: {service}"
        );
    }
}

// ---------------------------------------------------------------------------
// The Vault Registry (ADR-0005)
// ---------------------------------------------------------------------------

/// Where `vault add` writes.
fn config_path(home: &Path) -> std::path::PathBuf {
    home.join(".config")
        .join("bookmarks-but-better")
        .join("config.toml")
}

#[test]
fn a_machine_with_no_configuration_is_told_how_to_make_one() {
    let home = tempfile::tempdir().expect("temp dir");
    let output = bookmarks_but_better_in_home(home.path(), &["vault", "list"]);

    assert!(output.status.success(), "{}", stderr(&output));
    let listing = stdout(&output);
    assert!(listing.contains("no vault is configured yet"), "{listing}");
    assert!(listing.contains("vault add"), "{listing}");
    // Listing is a read: it must not bring the file into existence.
    assert!(!config_path(home.path()).exists());
}

#[test]
fn vault_add_stores_an_absolute_path_and_list_shows_its_state() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());

    let added =
        bookmarks_but_better_in_home(home.path(), &["vault", "add", "reading", &vault, "--init"]);
    assert!(added.status.success(), "{}", stderr(&added));
    assert!(
        stdout(&added).contains("added `reading`"),
        "{}",
        stdout(&added)
    );
    // Nothing is serving here, so there is nothing to restart and nothing said.
    assert!(!stdout(&added).contains("restart"), "{}", stdout(&added));

    let text = std::fs::read_to_string(config_path(home.path())).expect("config");
    assert!(text.contains("[vaults.reading]"), "{text}");
    assert!(text.contains(&vault), "{text}");

    let listing = stdout(&bookmarks_but_better_in_home(
        home.path(),
        &["vault", "list"],
    ));
    assert!(listing.contains("reading"), "{listing}");
    assert!(listing.contains("(ok)"), "{listing}");
}

#[test]
fn a_vault_that_was_never_initialized_is_listed_and_says_so() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());

    // No `--init`: the directory is real but is not a vault.
    let added = bookmarks_but_better_in_home(home.path(), &["vault", "add", "notes", &vault]);
    assert!(added.status.success(), "{}", stderr(&added));
    assert!(
        stdout(&added).contains("not an initialized vault"),
        "{}",
        stdout(&added)
    );

    let listing = stdout(&bookmarks_but_better_in_home(
        home.path(),
        &["vault", "list"],
    ));
    assert!(listing.contains("(not initialized)"), "{listing}");
}

#[test]
fn vault_add_refuses_what_the_daemon_would_refuse_at_startup() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());

    let bad_id = bookmarks_but_better_in_home(home.path(), &["vault", "add", "Not A Slug", &vault]);
    assert!(!bad_id.status.success());
    assert!(
        stderr(&bad_id).contains("lowercase letters"),
        "{}",
        stderr(&bad_id)
    );
    assert!(!config_path(home.path()).exists(), "nothing was written");

    // Overlapping roots: one vault inside another.
    assert!(
        bookmarks_but_better_in_home(home.path(), &["vault", "add", "outer", &vault])
            .status
            .success()
    );
    let nested = vault_arg(&vault_dir.path().join("nested"));
    let overlap = bookmarks_but_better_in_home(home.path(), &["vault", "add", "inner", &nested]);
    assert!(!overlap.status.success());
    assert!(stderr(&overlap).contains("overlap"), "{}", stderr(&overlap));

    // The refused entry did not land.
    let text = std::fs::read_to_string(config_path(home.path())).expect("config");
    assert!(!text.contains("inner"), "{text}");
}

#[test]
fn a_second_vault_cannot_quietly_take_an_id_that_is_taken() {
    let home = tempfile::tempdir().expect("temp dir");
    let first = tempfile::tempdir().expect("temp dir");
    let second = tempfile::tempdir().expect("temp dir");

    assert!(
        bookmarks_but_better_in_home(
            home.path(),
            &["vault", "add", "reading", &vault_arg(first.path())]
        )
        .status
        .success()
    );
    let clash = bookmarks_but_better_in_home(
        home.path(),
        &["vault", "add", "reading", &vault_arg(second.path())],
    );
    assert!(!clash.status.success());
    assert!(
        stderr(&clash).contains("already configured"),
        "{}",
        stderr(&clash)
    );

    // The original entry still points where it did.
    let text = std::fs::read_to_string(config_path(home.path())).expect("config");
    assert!(text.contains(&vault_arg(first.path())), "{text}");
    assert!(!text.contains(&vault_arg(second.path())), "{text}");
}

#[test]
fn vault_remove_takes_the_entry_and_never_the_directory() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    assert!(
        bookmarks_but_better_in_home(home.path(), &["vault", "add", "reading", &vault, "--init"])
            .status
            .success()
    );

    let removed = bookmarks_but_better_in_home(home.path(), &["vault", "remove", "reading"]);
    assert!(removed.status.success(), "{}", stderr(&removed));
    assert!(
        stdout(&removed).contains("was not touched"),
        "{}",
        stdout(&removed)
    );

    // The bookmarks are still there; only the line in the file went.
    assert!(
        vault_dir
            .path()
            .join(".bookmarks-but-better-folder.md")
            .is_file()
    );
    let text = std::fs::read_to_string(config_path(home.path())).expect("config");
    assert!(!text.contains("reading"), "{text}");

    // And removing what is not there names what is.
    let missing = bookmarks_but_better_in_home(home.path(), &["vault", "remove", "reading"]);
    assert!(!missing.status.success());
    assert!(
        stderr(&missing).contains("no vault `reading`"),
        "{}",
        stderr(&missing)
    );
}

#[test]
fn vault_rename_moves_the_entry_and_warns_that_clients_address_the_id() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    assert!(
        bookmarks_but_better_in_home(home.path(), &["vault", "add", "reading", &vault, "--init"])
            .status
            .success()
    );

    let renamed =
        bookmarks_but_better_in_home(home.path(), &["vault", "rename", "reading", "library"]);
    assert!(renamed.status.success(), "{}", stderr(&renamed));
    assert!(
        stdout(&renamed).contains("update them too"),
        "{}",
        stdout(&renamed)
    );

    let text = std::fs::read_to_string(config_path(home.path())).expect("config");
    assert!(text.contains("[vaults.library]"), "{text}");
    assert!(!text.contains("[vaults.reading]"), "{text}");
}

#[test]
fn vault_path_prints_one_line_for_a_script_and_fails_on_an_unknown_id() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    assert!(
        bookmarks_but_better_in_home(home.path(), &["vault", "add", "reading", &vault, "--init"])
            .status
            .success()
    );

    let printed = bookmarks_but_better_in_home(home.path(), &["vault", "path", "reading"]);
    assert!(printed.status.success(), "{}", stderr(&printed));
    assert_eq!(stdout(&printed).trim_end(), vault);

    let unknown = bookmarks_but_better_in_home(home.path(), &["vault", "path", "nope"]);
    assert!(!unknown.status.success());
    assert!(stderr(&unknown).contains("reading"), "{}", stderr(&unknown));
}

#[test]
fn vault_list_json_carries_the_whole_configuration() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    // A port the person chose, and nothing said about the bind address: the
    // JSON must tell the two apart, since a service installed before the
    // registry existed keeps its own port and a reader must not be told the
    // default is what was configured.
    let config_dir = home.path().join(".config").join("bookmarks-but-better");
    std::fs::create_dir_all(&config_dir).expect("config dir");
    std::fs::write(config_dir.join("config.toml"), "port = 47321\n").expect("config");
    assert!(
        bookmarks_but_better_in_home(home.path(), &["vault", "add", "reading", &vault, "--init"])
            .status
            .success()
    );

    let output = bookmarks_but_better_in_home(home.path(), &["vault", "list", "--json"]);
    assert!(output.status.success(), "{}", stderr(&output));
    let document: serde_json::Value = serde_json::from_str(&stdout(&output)).expect("JSON");

    assert_eq!(document["port"], 47321);
    assert!(document["bind"].is_null(), "{document}");
    let vaults = document["vaults"].as_array().expect("vaults");
    assert_eq!(vaults.len(), 1);
    assert_eq!(vaults[0]["id"], "reading");
    assert_eq!(vaults[0]["state"], "ok");
}

#[test]
fn doctor_and_rescan_accept_a_configured_id_instead_of_a_path() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    assert!(
        bookmarks_but_better_in_home(home.path(), &["vault", "add", "reading", &vault, "--init"])
            .status
            .success()
    );

    let examined = bookmarks_but_better_in_home(home.path(), &["doctor", "reading"]);
    assert!(examined.status.success(), "{}", stderr(&examined));
    assert!(stdout(&examined).contains(&vault), "{}", stdout(&examined));

    let rescanned = bookmarks_but_better_in_home(home.path(), &["rescan", "reading"]);
    assert!(rescanned.status.success(), "{}", stderr(&rescanned));

    // An id nothing configured names the ids that are.
    let unknown = bookmarks_but_better_in_home(home.path(), &["doctor", "nope"]);
    assert!(!unknown.status.success());
    assert!(stderr(&unknown).contains("reading"), "{}", stderr(&unknown));
}

#[test]
fn serve_takes_its_vaults_from_the_command_line_or_the_configuration_but_not_both() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());

    // Neither: the argument parser refuses rather than serving nothing.
    let neither = bookmarks_but_better_in_home(home.path(), &["serve"]);
    assert!(!neither.status.success());

    // Both: they are alternatives, not layers.
    let both =
        bookmarks_but_better_in_home(home.path(), &["serve", "--from-config", "--vault", &vault]);
    assert!(!both.status.success());
    assert!(
        stderr(&both).contains("cannot be used with"),
        "{}",
        stderr(&both)
    );
}

#[test]
fn serve_from_config_says_so_when_nothing_is_configured() {
    let home = tempfile::tempdir().expect("temp dir");
    let output = bookmarks_but_better_in_home(home.path(), &["serve", "--from-config"]);

    assert!(!output.status.success());
    assert!(stderr(&output).contains("vault add"), "{}", stderr(&output));
}

#[test]
fn serve_from_config_hosts_what_the_configuration_names() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());
    // Configured but never initialized, so the daemon refuses it by name —
    // which is the proof that the configured path is the one it opened.
    assert!(
        bookmarks_but_better_in_home(home.path(), &["vault", "add", "reading", &vault])
            .status
            .success()
    );

    let output = bookmarks_but_better_in_home(home.path(), &["serve", "--from-config"]);
    assert!(!output.status.success());
    let message = stderr(&output);
    assert!(message.contains("`reading`"), "{message}");
    assert!(message.contains(&vault), "{message}");
}

#[test]
fn a_single_vault_definition_still_spells_the_vault_as_a_bare_path() {
    // The shape every definition had before vaults carried ids. Writing
    // `--vault default=/path` instead would be equivalent to the daemon and
    // would still rewrite every installed definition on upgrade, for nothing.
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());

    let installed = bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--vault", &vault, "--no-start"],
    );
    assert!(installed.status.success(), "{}", stderr(&installed));

    let text = definition_text(&definition_path(home.path()));
    assert!(text.contains(&vault), "{text}");
    assert!(!text.contains(&format!("default={vault}")), "{text}");
}

#[test]
fn service_install_can_host_several_vaults() {
    let home = tempfile::tempdir().expect("temp dir");
    let reading = tempfile::tempdir().expect("temp dir");
    let archive = tempfile::tempdir().expect("temp dir");
    let reading_arg = format!("reading={}", vault_arg(reading.path()));
    let archive_arg = format!("archive={}", vault_arg(archive.path()));

    let installed = bookmarks_but_better_in_home(
        home.path(),
        &[
            "service",
            "install",
            "--vault",
            &reading_arg,
            "--vault",
            &archive_arg,
            "--no-start",
        ],
    );
    assert!(installed.status.success(), "{}", stderr(&installed));

    let text = definition_text(&definition_path(home.path()));
    assert!(text.contains(&vault_arg(reading.path())), "{text}");
    assert!(text.contains(&vault_arg(archive.path())), "{text}");

    let status = stdout(&bookmarks_but_better_in_home(
        home.path(),
        &["service", "status"],
    ));
    assert!(status.contains("(reading)"), "{status}");
    assert!(status.contains("(archive)"), "{status}");
}

#[test]
fn service_install_refuses_a_set_the_daemon_would_refuse() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let nested = vault_arg(&vault_dir.path().join("nested"));
    let outer = format!("outer={}", vault_arg(vault_dir.path()));
    let inner = format!("inner={nested}");

    let output = bookmarks_but_better_in_home(
        home.path(),
        &[
            "service",
            "install",
            "--vault",
            &outer,
            "--vault",
            &inner,
            "--no-start",
        ],
    );
    assert!(!output.status.success());
    assert!(stderr(&output).contains("overlap"), "{}", stderr(&output));
    assert!(
        !definition_path(home.path()).exists(),
        "nothing was installed"
    );
}

#[test]
fn service_install_from_config_expands_the_registry_into_the_definition() {
    let home = tempfile::tempdir().expect("temp dir");
    let reading = tempfile::tempdir().expect("temp dir");
    let archive = tempfile::tempdir().expect("temp dir");

    for (id, directory) in [("reading", &reading), ("archive", &archive)] {
        assert!(
            bookmarks_but_better_in_home(
                home.path(),
                &["vault", "add", id, &vault_arg(directory.path()), "--init"]
            )
            .status
            .success()
        );
    }

    let installed = bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--from-config", "--no-start"],
    );
    assert!(installed.status.success(), "{}", stderr(&installed));

    let text = definition_text(&definition_path(home.path()));
    assert!(text.contains(&vault_arg(reading.path())), "{text}");
    assert!(text.contains(&vault_arg(archive.path())), "{text}");

    // The definition is the expansion, not a reference: removing a vault from
    // the configuration leaves the installed service alone until it is
    // installed again.
    assert!(
        bookmarks_but_better_in_home(home.path(), &["vault", "remove", "archive"])
            .status
            .success()
    );
    let unchanged = definition_text(&definition_path(home.path()));
    assert_eq!(unchanged, text);

    let reinstalled = bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--from-config", "--no-start"],
    );
    assert!(reinstalled.status.success(), "{}", stderr(&reinstalled));
    let after = definition_text(&definition_path(home.path()));
    assert!(!after.contains(&vault_arg(archive.path())), "{after}");
}

#[test]
fn service_install_takes_its_vaults_from_one_place_or_the_other() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    let vault = vault_arg(vault_dir.path());

    let neither = bookmarks_but_better_in_home(home.path(), &["service", "install", "--no-start"]);
    assert!(!neither.status.success());

    let both = bookmarks_but_better_in_home(
        home.path(),
        &[
            "service",
            "install",
            "--from-config",
            "--vault",
            &vault,
            "--no-start",
        ],
    );
    assert!(!both.status.success());
    assert!(
        stderr(&both).contains("cannot be used with"),
        "{}",
        stderr(&both)
    );

    let empty = bookmarks_but_better_in_home(
        home.path(),
        &["service", "install", "--from-config", "--no-start"],
    );
    assert!(!empty.status.success());
    assert!(stderr(&empty).contains("vault add"), "{}", stderr(&empty));
}

#[test]
fn a_configured_port_reaches_the_installed_service() {
    let home = tempfile::tempdir().expect("temp dir");
    let vault_dir = tempfile::tempdir().expect("temp dir");
    assert!(
        bookmarks_but_better_in_home(
            home.path(),
            &[
                "vault",
                "add",
                "reading",
                &vault_arg(vault_dir.path()),
                "--init"
            ]
        )
        .status
        .success()
    );

    // Written by hand rather than through a command, because setting the port
    // is exactly the edit the file exists to allow.
    let config = config_path(home.path());
    let text = std::fs::read_to_string(&config).expect("config");
    std::fs::write(&config, format!("port = 52299\n{text}")).expect("write");

    assert!(
        bookmarks_but_better_in_home(
            home.path(),
            &["service", "install", "--from-config", "--no-start"]
        )
        .status
        .success()
    );
    let definition = definition_text(&definition_path(home.path()));
    assert!(definition.contains("52299"), "{definition}");
}
