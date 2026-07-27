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
async fn staging_left_by_a_crashed_run_is_purged_at_start() {
    let vault = tempfile::tempdir().expect("temp dir");
    bbb::initialize(vault.path()).expect("initialize");

    // Exactly what a process killed mid-delete leaves behind.
    let residue = vault.path().join(".bbb").join("staging").join("op");
    fs::create_dir_all(&residue).expect("create residue");
    fs::write(residue.join("0-React--a1b2c3d4.md"), b"half deleted").expect("write");

    let daemon = Daemon::open(&ServeOptions::new(vault.path())).expect("open");
    assert!(
        !vault.path().join(".bbb").join("staging").exists(),
        "the residue of a dead run is cleared once its lock is ours"
    );
    drop(daemon);
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
