//! Adversarial regressions for the filesystem-safety review.
//!
//! Each test here reproduces a way the daemon could have destroyed or leaked
//! data, and asserts the specific thing that must not happen: a link followed, a
//! file clobbered, a subtree erased, a half-finished change left behind.

mod support;

use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt as _;

use axum::http::StatusCode;
// Only the symlink regressions open a daemon directly; they are Unix-only,
// because Windows needs a privilege to create a symbolic link at all.
#[cfg(unix)]
use bbb::{Daemon, ServeOptions};
use serde_json::json;
use support::{Harness, find_node, vault_files, write_external};

/// A bookmark an external editor might drop into the vault.
fn external_bookmark(id: &str, title: &str) -> String {
    format!(
        "---\nbbb_id: {id}\nbbb_url: https://example.com\nbbb_title: {title}\n\
         bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\n"
    )
}

/// Whether this process is subject to ordinary permission checks.
///
/// Running as root bypasses them, which would make a permission-based failure
/// injection silently succeed and the test assert nothing. Rather than trust the
/// environment, the injection is probed for real.
#[cfg(unix)]
fn permission_injection_works() -> bool {
    let Ok(directory) = tempfile::tempdir() else {
        return false;
    };
    let locked = directory.path().join("locked");
    if fs::create_dir(&locked).is_err() {
        return false;
    }
    if fs::set_permissions(&locked, fs::Permissions::from_mode(0o500)).is_err() {
        return false;
    }
    let blocked = fs::write(locked.join("probe"), b"x").is_err();
    let _ = fs::set_permissions(&locked, fs::Permissions::from_mode(0o700));
    blocked
}

// ---------------------------------------------------------------------------
// Symbolic links are never followed by a mutation
// ---------------------------------------------------------------------------

#[cfg(unix)]
#[tokio::test]
async fn a_bookmark_swapped_for_a_symlink_is_never_written_through() {
    let outside = tempfile::tempdir().expect("temp dir");
    let secret = outside.path().join("secret.md");
    fs::write(&secret, b"private").expect("write secret");

    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let revision = created["revision"].as_str().expect("a revision").to_owned();

    // The classic swap: the name the client is about to write to becomes a link
    // pointing somewhere the daemon should never touch.
    let path = harness.root().join(format!("React--{id}.md"));
    fs::remove_file(&path).expect("remove");
    std::os::unix::fs::symlink(&secret, &path).expect("symlink");

    let response = harness
        .patch(
            &format!("/api/v1/bookmarks/{id}"),
            &json!({ "revision": revision, "title": "Owned" }),
        )
        .await;

    assert!(
        !response.status.is_success(),
        "writing through a link must be refused: {}",
        response.text()
    );
    assert_eq!(
        fs::read(&secret).expect("read secret"),
        b"private",
        "the file the link pointed at must never be written"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_symlinked_state_directory_stops_the_daemon_starting() {
    let outer = tempfile::tempdir().expect("temp dir");
    let vault = outer.path().join("vault");
    fs::create_dir(&vault).expect("create vault");
    bbb::initialize(&vault).expect("initialize");

    let elsewhere = outer.path().join("elsewhere");
    fs::create_dir(&elsewhere).expect("create elsewhere");
    std::os::unix::fs::symlink(&elsewhere, vault.join(".bbb")).expect("symlink");

    let error = Daemon::open(&ServeOptions::new(&vault))
        .expect_err("a vault whose .bbb is a link must not be served");
    assert!(error.to_string().contains(".bbb"), "{error}");
    assert!(
        fs::read_dir(&elsewhere)
            .expect("read elsewhere")
            .next()
            .is_none(),
        "nothing may be written through the link"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_symlinked_vault_root_is_refused() {
    let outer = tempfile::tempdir().expect("temp dir");
    let real = outer.path().join("real");
    fs::create_dir(&real).expect("create real");
    bbb::initialize(&real).expect("initialize");
    std::os::unix::fs::symlink(&real, outer.path().join("link")).expect("symlink");

    Daemon::open(&ServeOptions::new(outer.path().join("link")))
        .expect_err("a symlinked vault root must be refused");
    Daemon::open(&ServeOptions::new(&real)).expect("the real directory serves");
}

// ---------------------------------------------------------------------------
// A recursive delete never erases what it cannot describe
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_recursive_delete_refuses_a_folder_holding_unmanaged_files() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let revision = folder["revision"].as_str().expect("a revision").to_owned();
    harness
        .create_bookmark(&folder_id, "React", "https://react.dev")
        .await;

    // The user's own work, sitting in a folder bbb happens to manage.
    write_external(harness.root(), "Dev/notes.txt", "my thesis");
    write_external(harness.root(), "Dev/draft.md", "# not a bookmark");
    harness.post("/api/v1/rescan", &json!({})).await;

    let before = vault_files(harness.root());
    let response = harness
        .delete(&format!(
            "/api/v1/folders/{folder_id}?revision={revision}&recursive=true"
        ))
        .await;

    let problem = response.expect_problem(StatusCode::CONFLICT, "subtree_has_unknown_files");
    let detail = problem["detail"].as_str().expect("a detail");
    assert!(
        detail.contains("notes.txt") || detail.contains("draft.md"),
        "{detail}"
    );
    assert!(
        detail.contains("remove them yourself"),
        "the refusal says what to do: {detail}"
    );

    assert_eq!(
        vault_files(harness.root()),
        before,
        "a refused recursive delete must not remove a single file"
    );
    assert_eq!(
        fs::read_to_string(harness.root().join("Dev/notes.txt")).expect("read"),
        "my thesis"
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_recursive_delete_refuses_a_folder_holding_a_symlink() {
    let outside = tempfile::tempdir().expect("temp dir");
    let target = outside.path().join("target.md");
    fs::write(&target, b"outside").expect("write");

    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let revision = folder["revision"].as_str().expect("a revision").to_owned();

    std::os::unix::fs::symlink(&target, harness.root().join("Dev").join("link.md"))
        .expect("symlink");
    harness.post("/api/v1/rescan", &json!({})).await;

    harness
        .delete(&format!(
            "/api/v1/folders/{folder_id}?revision={revision}&recursive=true"
        ))
        .await
        .expect_problem(StatusCode::CONFLICT, "subtree_has_unknown_files");

    assert!(harness.root().join("Dev").is_dir(), "the folder survives");
    assert_eq!(
        fs::read(&target).expect("read target"),
        b"outside",
        "the link target is untouched"
    );
}

#[tokio::test]
async fn a_recursive_delete_succeeds_when_the_whole_subtree_is_managed() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let revision = folder["revision"].as_str().expect("a revision").to_owned();

    let nested = harness.create_folder(&folder_id, "Nested").await;
    let nested_id = nested["id"].as_str().expect("an id").to_owned();
    harness
        .create_bookmark(&folder_id, "React", "https://react.dev")
        .await;
    harness
        .create_bookmark(&nested_id, "Vite", "https://vite.dev")
        .await;

    let response = harness
        .delete(&format!(
            "/api/v1/folders/{folder_id}?revision={revision}&recursive=true"
        ))
        .await;
    assert_eq!(
        response.status,
        StatusCode::NO_CONTENT,
        "{}",
        response.text()
    );

    assert!(!harness.root().join("Dev").exists());
    let tree = harness.tree().await;
    assert!(find_node(&tree, &folder_id).is_none());
    assert!(find_node(&tree, &nested_id).is_none());
}

#[tokio::test]
async fn a_recursive_delete_keeps_a_bookmarks_assets_with_it() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let revision = folder["revision"].as_str().expect("a revision").to_owned();
    let bookmark = harness
        .create_bookmark(&folder_id, "React", "https://react.dev")
        .await;
    let id = bookmark["id"].as_str().expect("an id").to_owned();

    // Assets belong to their bookmark, so they are managed by association and
    // must not be mistaken for the user's unrelated files.
    let assets = harness
        .root()
        .join("Dev")
        .join(format!("React--{id}.assets"));
    fs::create_dir(&assets).expect("create assets");
    fs::write(assets.join("logo.png"), b"\x89PNG").expect("write logo");
    harness.post("/api/v1/rescan", &json!({})).await;

    let response = harness
        .delete(&format!(
            "/api/v1/folders/{folder_id}?revision={revision}&recursive=true"
        ))
        .await;
    assert_eq!(
        response.status,
        StatusCode::NO_CONTENT,
        "assets must not block the delete: {}",
        response.text()
    );
    assert!(!harness.root().join("Dev").exists());
}

// ---------------------------------------------------------------------------
// A move never destroys what is already at the destination
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_move_never_overwrites_a_file_squatting_on_the_target_name() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let revision = created["revision"].as_str().expect("a revision").to_owned();

    // Something already occupies the exact name the move would use.
    let squatter = format!("Dev/React--{id}.md");
    write_external(harness.root(), &squatter, "PRECIOUS");

    let response = harness
        .post(
            &format!("/api/v1/bookmarks/{id}/move"),
            &json!({ "revision": revision, "parentId": folder_id }),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());

    assert_eq!(
        fs::read_to_string(harness.root().join(&squatter)).expect("read"),
        "PRECIOUS",
        "the file already at the destination must survive untouched"
    );
    assert_eq!(response.json()["id"], id, "the identity is preserved");
    assert_eq!(response.json()["parentId"], folder_id);

    // The bookmark really is in the destination, under some other name.
    let moved = harness.get(&format!("/api/v1/bookmarks/{id}")).await.json();
    assert_eq!(moved["parentId"], folder_id);
    assert!(!harness.root().join(format!("React--{id}.md")).exists());
}

#[tokio::test]
async fn a_create_never_overwrites_a_file_that_appears_underneath_it() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;

    // A directory already full of names the allocator would like to use.
    write_external(harness.root(), "React.md", "not a bookmark");
    write_external(harness.root(), "React-2.md", "also not a bookmark");
    harness.post("/api/v1/rescan", &json!({})).await;

    harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;

    assert_eq!(
        fs::read_to_string(harness.root().join("React.md")).expect("read"),
        "not a bookmark"
    );
    assert_eq!(
        fs::read_to_string(harness.root().join("React-2.md")).expect("read"),
        "also not a bookmark"
    );
}

// ---------------------------------------------------------------------------
// The static UI never serves through a link
// ---------------------------------------------------------------------------

#[cfg(unix)]
#[tokio::test]
async fn the_ui_never_serves_a_symlinked_file() {
    let staging = tempfile::tempdir().expect("temp dir");
    let ui = staging.path().join("dist");
    fs::create_dir(&ui).expect("create ui");
    fs::write(ui.join("index.html"), "<!doctype html><title>bbb</title>").expect("index");

    let secret = staging.path().join("id_rsa");
    fs::write(&secret, "PRIVATE KEY").expect("secret");
    std::os::unix::fs::symlink(&secret, ui.join("id_rsa")).expect("symlink");
    fs::create_dir(staging.path().join("outside")).expect("create outside");
    fs::write(staging.path().join("outside/x.txt"), "OUTSIDE").expect("write");
    std::os::unix::fs::symlink(staging.path().join("outside"), ui.join("assets"))
        .expect("symlink dir");

    let harness = Harness::with_options(|options| {
        options.ui_dir = Some(ui.clone());
    });

    for path in ["/id_rsa", "/assets/x.txt"] {
        let response = harness.get(path).await;
        assert!(
            !response.text().contains("PRIVATE KEY") && !response.text().contains("OUTSIDE"),
            "{path} leaked through a symlink: {}",
            response.text()
        );
    }

    // A real file is still served normally.
    let index = harness.get("/").await;
    assert_eq!(index.status, StatusCode::OK);
    assert!(index.text().contains("<!doctype html>"));
}

// ---------------------------------------------------------------------------
// Staging: crash residue, and rollback under an injected failure
// ---------------------------------------------------------------------------

#[tokio::test]
async fn residue_with_no_manifest_is_kept_and_reported_never_purged() {
    let vault = tempfile::tempdir().expect("temp dir");
    bbb::initialize(vault.path()).expect("initialize");

    // What a process killed mid-delete leaves, with its record lost too. The
    // bytes are the user's only copy; deleting them would be the worst thing
    // the daemon could do here.
    let residue = vault.path().join(".bbb").join("staging").join("op-0");
    fs::create_dir_all(&residue).expect("create residue");
    fs::write(residue.join("0-React--a1b2c3d4.md"), b"the only copy").expect("write");

    let harness = Harness::adopt(vault);

    assert_eq!(
        fs::read_to_string(
            harness
                .root()
                .join(".bbb/staging/op-0/0-React--a1b2c3d4.md")
        )
        .expect("the staged file is still there"),
        "the only copy",
        "an entry with no manifest must never be discarded"
    );

    let report = fs::read_to_string(harness.root().join(".bbb/staging/recovery.txt"))
        .expect("a recovery report is written");
    assert!(report.contains("nothing here has been deleted"), "{report}");
    assert!(report.contains("op-0"), "{report}");

    // And the user is told, in the UI and on the command line.
    let warnings = harness.get("/api/v1/health").await.json()["warnings"]
        .as_array()
        .expect("warnings")
        .clone();
    assert!(
        warnings
            .iter()
            .any(|warning| warning["code"] == "staged_entries_retained"),
        "{warnings:?}"
    );
}

#[tokio::test]
async fn an_interrupted_delete_is_rolled_back_at_startup() {
    let vault = tempfile::tempdir().expect("temp dir");
    bbb::initialize(vault.path()).expect("initialize");
    fs::write(
        vault.path().join("Notes--11112222.md"),
        external_bookmark("11112222", "Notes"),
    )
    .expect("write bookmark");

    // A delete that moved the entry out but never committed.
    let residue = vault.path().join(".bbb").join("staging").join("op-0");
    fs::create_dir_all(&residue).expect("create residue");
    let staged = residue.join("0-Notes--11112222.md");
    fs::rename(vault.path().join("Notes--11112222.md"), &staged).expect("stage");
    fs::write(
        residue.join("manifest.json"),
        r#"{"version":1,"operation":"delete_bookmark","phase":"staging","entries":[
            {"origin":"","name":"Notes--11112222.md","staged":"0-Notes--11112222.md","kind":"file"}]}"#,
    )
    .expect("manifest");

    let harness = Harness::adopt(vault);

    assert!(
        harness.root().join("Notes--11112222.md").is_file(),
        "an uncommitted delete is undone, so the bookmark comes back"
    );
    assert!(!harness.root().join(".bbb/staging/op-0").exists());
    let tree = harness.tree().await;
    assert!(find_node(&tree, "11112222").is_some());
}

#[tokio::test]
async fn an_interrupted_delete_past_its_commit_point_is_finished_at_startup() {
    let vault = tempfile::tempdir().expect("temp dir");
    bbb::initialize(vault.path()).expect("initialize");

    // A delete that committed — the caller was told it succeeded — and then
    // died before the bytes were destroyed. Undoing it would resurrect a
    // bookmark the user was told was gone.
    let residue = vault.path().join(".bbb").join("staging").join("op-0");
    fs::create_dir_all(&residue).expect("create residue");
    fs::write(residue.join("0-Notes--11112222.md"), b"deleted content").expect("write");
    fs::write(
        residue.join("manifest.json"),
        r#"{"version":1,"operation":"delete_bookmark","phase":"committed","entries":[
            {"origin":"","name":"Notes--11112222.md","staged":"0-Notes--11112222.md","kind":"file"}]}"#,
    )
    .expect("manifest");

    let harness = Harness::adopt(vault);

    assert!(
        !harness.root().join("Notes--11112222.md").exists(),
        "a committed delete is completed, not resurrected"
    );
    assert!(!harness.root().join(".bbb/staging/op-0").exists());
    let tree = harness.tree().await;
    assert!(find_node(&tree, "11112222").is_none());
}

#[tokio::test]
async fn doctor_reports_retained_staging_and_exits_non_zero() {
    let vault = tempfile::tempdir().expect("temp dir");
    bbb::initialize(vault.path()).expect("initialize");
    let residue = vault.path().join(".bbb").join("staging").join("op-0");
    fs::create_dir_all(&residue).expect("create residue");
    fs::write(residue.join("0-orphan.md"), b"orphan").expect("write");

    let report = bbb::doctor::examine(vault.path()).expect("examine");
    assert!(
        !report.is_healthy(),
        "retained staging is a problem doctor must not pass over"
    );
    assert!(
        report
            .errors
            .iter()
            .any(|finding| finding.code == "staged_entries_retained"),
        "{:?}",
        report.errors
    );
}

#[cfg(unix)]
#[tokio::test]
async fn a_delete_rolls_back_when_the_assets_cannot_be_moved() {
    if !permission_injection_works() {
        eprintln!("skipped: this process is not subject to permission checks");
        return;
    }
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let revision = created["revision"].as_str().expect("a revision").to_owned();

    let markdown = harness.root().join(format!("React--{id}.md"));
    let assets = harness.root().join(format!("React--{id}.assets"));
    fs::create_dir(&assets).expect("create assets");
    fs::write(assets.join("logo.png"), b"\x89PNG").expect("write logo");
    let bytes_before = fs::read(&markdown).expect("read");

    // Renaming a directory rewrites its `..` entry, so a directory without
    // write permission cannot be moved. The bookmark file moves into staging
    // first, and this makes the second step fail — the exact half-done delete
    // the staging area exists to undo.
    fs::set_permissions(&assets, fs::Permissions::from_mode(0o500)).expect("chmod");

    let response = harness
        .delete(&format!("/api/v1/bookmarks/{id}?revision={revision}"))
        .await;
    let restored = markdown.is_file();
    fs::set_permissions(&assets, fs::Permissions::from_mode(0o700)).expect("chmod back");

    assert!(
        !response.status.is_success(),
        "a delete that cannot finish must report failure: {}",
        response.text()
    );
    assert!(
        restored,
        "the bookmark must be put back when its assets cannot be removed"
    );
    assert_eq!(
        fs::read(&markdown).expect("read"),
        bytes_before,
        "the restored bookmark is byte-identical"
    );
    assert!(assets.is_dir(), "the assets are still there too");
}

#[cfg(unix)]
#[tokio::test]
async fn a_failed_move_leaves_the_bookmark_where_it_was() {
    if !permission_injection_works() {
        eprintln!("skipped: this process is not subject to permission checks");
        return;
    }
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let revision = created["revision"].as_str().expect("a revision").to_owned();
    let markdown = harness.root().join(format!("React--{id}.md"));
    let bytes_before = fs::read(&markdown).expect("read");

    let destination = harness.root().join("Dev");
    fs::set_permissions(&destination, fs::Permissions::from_mode(0o500)).expect("chmod");

    let response = harness
        .post(
            &format!("/api/v1/bookmarks/{id}/move"),
            &json!({ "revision": revision, "parentId": folder_id }),
        )
        .await;
    let still_there = markdown.is_file();
    fs::set_permissions(&destination, fs::Permissions::from_mode(0o700)).expect("chmod back");

    assert!(
        !response.status.is_success(),
        "a move into a folder that refuses writes must fail: {}",
        response.text()
    );
    assert!(still_there, "the bookmark stays where it was");
    assert_eq!(fs::read(&markdown).expect("read"), bytes_before);
}

// ---------------------------------------------------------------------------
// Scan and publish are ordered
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_reconciles_never_publish_a_tree_older_than_a_mutation() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let vault = std::sync::Arc::clone(harness.daemon().vault());

    // Reconciles hammering away while mutations land. Without the scan gate a
    // reconcile that started before a create can publish after it, and the new
    // bookmark disappears from the served tree until something rescans.
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let workers: Vec<_> = (0..3)
        .map(|_| {
            let vault = std::sync::Arc::clone(&vault);
            let stop = std::sync::Arc::clone(&stop);
            std::thread::spawn(move || {
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    let _ = vault.reconcile();
                    // A pause between rounds. Reconciles in the real daemon are
                    // debounced and periodic; spinning with no gap would starve
                    // the mutations on an unfair mutex and measure the lock's
                    // fairness rather than the ordering this test is about.
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            })
        })
        .collect();

    let mut ids = Vec::new();
    for index in 0..12 {
        let created = harness
            .create_bookmark(
                &root_id,
                &format!("Bookmark {index}"),
                &format!("https://example.com/{index}"),
            )
            .await;
        ids.push(created["id"].as_str().expect("an id").to_owned());
    }

    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    for worker in workers {
        worker.join().expect("worker");
    }

    // Every create returned successfully, so every one of them must be visible
    // in the published tree without any further rescan.
    let tree = harness.tree().await;
    for id in &ids {
        assert!(
            find_node(&tree, id).is_some(),
            "{id} was published and then lost to a stale scan"
        );
    }
}

#[tokio::test]
async fn an_external_bookmark_and_a_mutation_are_both_visible_afterwards() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;

    write_external(
        harness.root(),
        "Outside--99998888.md",
        &external_bookmark("99998888", "Outside"),
    );
    let created = harness
        .create_bookmark(&root_id, "Inside", "https://example.com")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();

    let tree = harness.tree().await;
    assert!(
        find_node(&tree, "99998888").is_some(),
        "the externally written bookmark is in the published tree"
    );
    assert!(
        find_node(&tree, &id).is_some(),
        "so is the one the daemon wrote"
    );
}

// ---------------------------------------------------------------------------
// A commit is bound to the file that was validated
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_file_replaced_between_read_and_write_is_a_conflict_and_survives() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let revision = created["revision"].as_str().expect("a revision").to_owned();

    // Somebody replaces the file — not edits it, replaces it, so the name comes
    // to mean a different object entirely.
    let path = harness.root().join(format!("React--{id}.md"));
    let theirs = external_bookmark(&id, "Theirs");
    fs::remove_file(&path).expect("remove");
    fs::write(&path, &theirs).expect("write theirs");

    let response = harness
        .patch(
            &format!("/api/v1/bookmarks/{id}"),
            &json!({ "revision": revision, "title": "Mine" }),
        )
        .await;

    response.expect_problem(StatusCode::CONFLICT, "stale_revision");
    assert_eq!(
        fs::read_to_string(&path).expect("read"),
        theirs,
        "the replacement must be left exactly as it was"
    );
}

#[tokio::test]
async fn a_file_replaced_before_a_delete_is_a_conflict_and_survives() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let revision = created["revision"].as_str().expect("a revision").to_owned();

    let path = harness.root().join(format!("React--{id}.md"));
    let theirs = external_bookmark(&id, "Theirs");
    fs::remove_file(&path).expect("remove");
    fs::write(&path, &theirs).expect("write theirs");

    harness
        .delete(&format!("/api/v1/bookmarks/{id}?revision={revision}"))
        .await
        .expect_problem(StatusCode::CONFLICT, "stale_revision");

    assert_eq!(
        fs::read_to_string(&path).expect("read"),
        theirs,
        "a stale delete must not remove the replacement"
    );
}

#[tokio::test]
async fn an_identical_rewrite_still_counts_as_the_same_file() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let path = harness.root().join(format!("React--{id}.md"));

    // Rewritten byte-for-byte by an external tool: a different inode, the same
    // content. The revision the client holds is still accurate, so the daemon
    // reads the current file and proceeds from that.
    let bytes = fs::read(&path).expect("read");
    fs::remove_file(&path).expect("remove");
    fs::write(&path, &bytes).expect("rewrite");
    harness.post("/api/v1/rescan", &json!({})).await;

    let current = harness.get(&format!("/api/v1/bookmarks/{id}")).await.json();
    let revision = current["revision"].as_str().expect("a revision").to_owned();
    let response = harness
        .patch(
            &format!("/api/v1/bookmarks/{id}"),
            &json!({ "revision": revision, "title": "React 19" }),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());
    assert!(
        fs::read_to_string(&path)
            .expect("read")
            .contains("bbb_title: React 19")
    );
}

// ---------------------------------------------------------------------------
// A recursive delete is bound to the directory it verified
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Folder moves: a real primitive, or an honest refusal
// ---------------------------------------------------------------------------

#[tokio::test]
async fn a_folder_move_either_works_or_is_refused_as_unsupported() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let source = harness.create_folder(&root_id, "Source").await;
    let source_id = source["id"].as_str().expect("an id").to_owned();
    let revision = source["revision"].as_str().expect("a revision").to_owned();
    let destination = harness.create_folder(&root_id, "Destination").await;
    let destination_id = destination["id"].as_str().expect("an id").to_owned();

    let response = harness
        .post(
            &format!("/api/v1/bookmarks/{source_id}/move"),
            &json!({ "revision": revision, "parentId": destination_id }),
        )
        .await;

    // Linux, macOS and Windows all have a no-replace rename, so the move works
    // there. Anywhere else it is refused outright rather than risking a clobber.
    if response.status == StatusCode::OK {
        assert_eq!(response.json()["parentId"], destination_id);
        assert!(harness.root().join("Destination").join("Source").is_dir());
        assert!(!harness.root().join("Source").exists());
    } else {
        response.expect_problem(StatusCode::NOT_IMPLEMENTED, "unsupported_operation");
        assert!(
            harness.root().join("Source").is_dir(),
            "a refused move leaves the folder where it was"
        );
    }
}

#[tokio::test]
async fn a_folder_move_never_overwrites_a_directory_squatting_on_the_name() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let source = harness.create_folder(&root_id, "Source").await;
    let source_id = source["id"].as_str().expect("an id").to_owned();
    let revision = source["revision"].as_str().expect("a revision").to_owned();
    let destination = harness.create_folder(&root_id, "Destination").await;
    let destination_id = destination["id"].as_str().expect("an id").to_owned();

    // Something already holds the name the move would like to use.
    write_external(
        harness.root(),
        "Destination/Source/precious.txt",
        "PRECIOUS",
    );

    let response = harness
        .post(
            &format!("/api/v1/bookmarks/{source_id}/move"),
            &json!({ "revision": revision, "parentId": destination_id }),
        )
        .await;

    assert_eq!(
        fs::read_to_string(harness.root().join("Destination/Source/precious.txt")).expect("read"),
        "PRECIOUS",
        "the directory already at the destination must survive"
    );
    if response.status == StatusCode::OK {
        assert_eq!(response.json()["parentId"], destination_id);
    } else {
        assert!(
            !response.status.is_success(),
            "a refusal is fine; a clobber is not"
        );
    }
}

// ---------------------------------------------------------------------------
// Reconciles never observe a mutation in progress
// ---------------------------------------------------------------------------

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_reconcile_never_publishes_a_half_finished_delete() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;

    // Bookmarks with assets: deleting one is a two-rename operation, and a scan
    // between the two would see a bookmark whose assets outlived it.
    let mut ids = Vec::new();
    for index in 0..6 {
        let created = harness
            .create_bookmark(
                &root_id,
                &format!("Bookmark {index}"),
                &format!("https://example.com/{index}"),
            )
            .await;
        let id = created["id"].as_str().expect("an id").to_owned();
        let assets = harness
            .root()
            .join(format!("Bookmark {index}--{id}.assets"));
        fs::create_dir(&assets).expect("create assets");
        fs::write(assets.join("logo.png"), b"PNG").expect("write logo");
        ids.push((id, created["revision"].as_str().expect("rev").to_owned()));
    }
    harness.post("/api/v1/rescan", &json!({})).await;

    let vault = std::sync::Arc::clone(harness.daemon().vault());
    let stop = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let workers: Vec<_> = (0..3)
        .map(|_| {
            let vault = std::sync::Arc::clone(&vault);
            let stop = std::sync::Arc::clone(&stop);
            std::thread::spawn(move || {
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    let _ = vault.reconcile();
                    std::thread::sleep(std::time::Duration::from_millis(1));
                }
            })
        })
        .collect();

    for (id, revision) in &ids {
        // Fetch a current revision, since a concurrent reconcile may have moved
        // the generation on without changing the file.
        let current = harness.get(&format!("/api/v1/bookmarks/{id}")).await;
        let revision = current
            .json()
            .get("revision")
            .and_then(|value| value.as_str())
            .map_or_else(|| revision.clone(), str::to_owned);
        let response = harness
            .delete(&format!("/api/v1/bookmarks/{id}?revision={revision}"))
            .await;
        assert_eq!(
            response.status,
            StatusCode::NO_CONTENT,
            "{}",
            response.text()
        );
    }

    stop.store(true, std::sync::atomic::Ordering::Relaxed);
    for worker in workers {
        worker.join().expect("worker");
    }

    // Every delete removed both halves, and the published tree agrees.
    let tree = harness.tree().await;
    for (id, _) in &ids {
        assert!(find_node(&tree, id).is_none(), "{id} is still in the tree");
        assert!(
            !harness.root().join(format!("{id}.assets")).exists(),
            "assets for {id} outlived their bookmark"
        );
    }
    let leftovers: Vec<String> = vault_files(harness.root())
        .into_iter()
        .map(|(path, _)| path)
        .filter(|path| path.contains(".assets"))
        .collect();
    assert!(leftovers.is_empty(), "orphaned assets: {leftovers:?}");
}
