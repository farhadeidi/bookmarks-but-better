//! Serving the UI, guarding the host, and holding the vault.

mod support;

use std::fs;

use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use bookmarks_but_better::{Daemon, ServeOptions};
use support::{Harness, TEST_HOST};

/// Writes a minimal built-UI directory and returns its path.
fn build_ui(directory: &std::path::Path) -> std::path::PathBuf {
    let ui = directory.join("dist");
    fs::create_dir_all(ui.join("assets")).expect("create ui dir");
    fs::write(
        ui.join("index.html"),
        "<!doctype html><title>bookmarks-but-better</title>",
    )
    .expect("index");
    fs::write(
        ui.join("assets").join("app.js"),
        "console.log('bookmarks-but-better')",
    )
    .expect("asset");
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
    assert_eq!(asset.text(), "console.log('bookmarks-but-better')");

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
    bookmarks_but_better::initialize(vault.path()).expect("initialize");

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

    for host in [
        "evil.example",
        "bookmarks.local:52222",
        "192.168.1.10",
        // Still refused on the port the default moved away from.
        "bookmarks.local:47321",
    ] {
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

    for host in [
        TEST_HOST,
        "localhost:52222",
        "127.0.0.1",
        "[::1]:52222",
        // An installation explicitly configured on the previous default keeps
        // working: the guard reads the name, never the port.
        "127.0.0.1:47321",
    ] {
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
    bookmarks_but_better::initialize(vault.path()).expect("initialize");
    let options = ServeOptions::new(vault.path());

    let first = Daemon::open(&options).expect("the first daemon takes the vault");

    let error = Daemon::open(&options).expect_err("the second daemon must be refused");
    let message = error.to_string();
    assert!(
        message.contains("already holds this vault"),
        "the error names the problem: {message}"
    );
    assert!(
        message.contains(".bookmarks-but-better"),
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
    assert!(
        message.contains("bookmarks-but-better init --vault"),
        "{message}"
    );
    assert!(message.contains("--init"), "{message}");

    assert!(
        !directory
            .path()
            .join(".bookmarks-but-better-folder.md")
            .exists(),
        "a refused start must not write into the directory"
    );

    // The explicit opt-in is what makes it servable.
    bookmarks_but_better::initialize(directory.path()).expect("initialize");
    Daemon::open(&options).expect("an initialized vault serves");
}

/// The default port moved from 47321 to 52222 so that several browsers on one
/// machine agree on where the daemon is without being told.
///
/// There is deliberately no compatibility listener: the daemon binds one port.
/// What must keep working is an installation that was *explicitly* configured
/// on the old one, which is a matter of the explicit value surviving — never of
/// the daemon guessing a second port to listen on.
#[test]
fn the_default_port_is_52222_and_an_explicit_port_survives() {
    assert_eq!(bookmarks_but_better::server::DEFAULT_PORT, 52222);
    assert_eq!(ServeOptions::new("/vault").port, 52222);

    let explicit =
        ServeOptions::new("/vault").with_address(bookmarks_but_better::server::DEFAULT_BIND, 47321);
    assert_eq!(
        explicit.port, 47321,
        "an explicitly configured port is never replaced by the default"
    );
    assert!(explicit.bind.is_loopback());
}
