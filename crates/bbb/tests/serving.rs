//! Serving the UI, guarding the host, and holding the vault.

mod support;

use std::fs;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use bbb::{Daemon, ServeOptions};
use support::{Harness, TEST_HOST};

/// Writes a minimal built-UI directory and returns its path.
fn build_ui(directory: &std::path::Path) -> std::path::PathBuf {
    let ui = directory.join("dist");
    fs::create_dir_all(ui.join("assets")).expect("create ui dir");
    fs::write(ui.join("index.html"), "<!doctype html><title>bbb</title>").expect("index");
    fs::write(ui.join("assets").join("app.js"), "console.log('bbb')").expect("asset");
    ui
}

#[tokio::test]
async fn the_ui_is_served_with_an_spa_fallback_and_the_api_still_wins() {
    let staging = tempfile::tempdir().expect("temp dir");
    let ui = build_ui(staging.path());
    let harness = Harness::with_options(|options| {
        options.ui_dir = Some(ui.clone());
    });

    // A real file is served as itself.
    let asset = harness.get("/assets/app.js").await;
    assert_eq!(asset.status, StatusCode::OK);
    assert_eq!(asset.text(), "console.log('bbb')");

    // The index is served at the root.
    let index = harness.get("/").await;
    assert_eq!(index.status, StatusCode::OK);
    assert!(index.text().contains("<!doctype html>"));

    // A client-side route with no file behind it falls back to the index, so
    // deep links work after a refresh.
    let route = harness.get("/settings/appearance").await;
    assert_eq!(route.status, StatusCode::OK);
    assert!(
        route.text().contains("<!doctype html>"),
        "an SPA route serves the index: {}",
        route.text()
    );

    // But the API keeps its own 404: an unknown API path must never come back
    // as an HTML page with status 200.
    let missing = harness.get("/api/v1/nonexistent").await;
    missing.expect_problem(StatusCode::NOT_FOUND, "route_not_found");

    // And a real API route is unaffected by the fallback.
    assert_eq!(harness.get("/api/v1/health").await.status, StatusCode::OK);
}

#[tokio::test]
async fn without_a_ui_directory_every_non_api_path_is_a_problem_document() {
    let harness = Harness::new();

    let response = harness.get("/").await;
    response.expect_problem(StatusCode::NOT_FOUND, "route_not_found");

    let deep = harness.get("/settings/appearance").await;
    deep.expect_problem(StatusCode::NOT_FOUND, "route_not_found");

    assert_eq!(harness.get("/api/v1/health").await.status, StatusCode::OK);
}

#[tokio::test]
async fn a_ui_directory_without_an_index_is_refused_at_startup() {
    let staging = tempfile::tempdir().expect("temp dir");
    let empty = staging.path().join("not-a-build");
    fs::create_dir_all(&empty).expect("create dir");

    let vault = tempfile::tempdir().expect("temp dir");
    bbb::initialize(vault.path()).expect("initialize");

    let options = ServeOptions::new(vault.path()).with_ui_dir(&empty);
    let error = Daemon::open(&options).expect_err("a directory with no index cannot serve the UI");
    assert!(
        error.to_string().contains("index.html"),
        "the error says what is missing: {error}"
    );
}

#[tokio::test]
async fn a_non_loopback_host_header_is_refused() {
    let harness = Harness::new();

    for host in ["evil.example", "bookmarks.local:47321", "192.168.1.10"] {
        let request = Request::builder()
            .method("GET")
            .uri("/api/v1/health")
            .header(header::HOST, host)
            .body(Body::empty())
            .expect("build request");
        let response = harness.send(request).await;
        response.expect_problem(StatusCode::FORBIDDEN, "host_not_allowed");
    }
}

#[tokio::test]
async fn a_request_with_no_host_header_is_refused() {
    let harness = Harness::new();
    let request = Request::builder()
        .method("GET")
        .uri("/api/v1/health")
        .body(Body::empty())
        .expect("build request");

    harness
        .send(request)
        .await
        .expect_problem(StatusCode::FORBIDDEN, "host_not_allowed");
}

#[tokio::test]
async fn loopback_hosts_are_allowed() {
    let harness = Harness::new();

    for host in [TEST_HOST, "localhost:47321", "127.0.0.1", "[::1]:47321"] {
        let request = Request::builder()
            .method("GET")
            .uri("/api/v1/health")
            .header(header::HOST, host)
            .body(Body::empty())
            .expect("build request");
        assert_eq!(
            harness.send(request).await.status,
            StatusCode::OK,
            "{host} must be allowed"
        );
    }
}

#[tokio::test]
async fn a_second_daemon_cannot_open_a_vault_that_is_already_held() {
    let vault = tempfile::tempdir().expect("temp dir");
    bbb::initialize(vault.path()).expect("initialize");
    let options = ServeOptions::new(vault.path());

    let first = Daemon::open(&options).expect("the first daemon takes the vault");

    let error = Daemon::open(&options).expect_err("the second daemon must be refused");
    let message = error.to_string();
    assert!(
        message.contains("already holds this vault"),
        "the error names the problem: {message}"
    );
    assert!(
        message.contains(".bbb"),
        "the error names the lock file: {message}"
    );

    // Releasing the first daemon frees the vault again, so a restart works.
    drop(first);
    Daemon::open(&options).expect("the vault is free once the holder is gone");
}

#[tokio::test]
async fn serving_an_uninitialized_directory_is_refused_with_a_usable_hint() {
    let directory = tempfile::tempdir().expect("temp dir");
    let options = ServeOptions::new(directory.path());

    let error = Daemon::open(&options).expect_err("an uninitialized directory is not a vault");
    let message = error.to_string();
    assert!(message.contains("bbb init --vault"), "{message}");
    assert!(message.contains("--init"), "{message}");

    assert!(
        !directory.path().join(".bbb-folder.md").exists(),
        "a refused start must not write into the directory"
    );

    // The explicit opt-in is what makes it servable.
    bbb::initialize(directory.path()).expect("initialize");
    Daemon::open(&options).expect("an initialized vault serves");
}
