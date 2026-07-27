//! Shared scaffolding for the integration tests.
//!
//! Every test gets its own temporary vault and its own daemon, so nothing is
//! shared between them but the code under test. Requests go through the real
//! router — the same one `bbb serve` binds — rather than through the vault API
//! directly, so the HTTP contract is what is being asserted.

#![allow(dead_code)]

use std::fs;
use std::path::{Path, PathBuf};

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode, header};
use bbb::{Daemon, ServeOptions};
use serde_json::Value;
use tempfile::TempDir;
use tower::ServiceExt as _;

/// The `Host` every test sends; the daemon refuses requests without one.
pub(crate) const TEST_HOST: &str = "127.0.0.1:47321";

/// A temporary, initialized vault with a daemon in front of it.
pub(crate) struct Harness {
    daemon: Daemon,
    directory: TempDir,
}

impl Harness {
    /// Creates an empty initialized vault and opens a daemon on it.
    pub(crate) fn new() -> Self {
        Self::with_options(|_| {})
    }

    /// As [`Harness::new`], but with a chance to adjust the serve options.
    pub(crate) fn with_options(configure: impl FnOnce(&mut ServeOptions)) -> Self {
        let directory = tempfile::tempdir().expect("temp dir");
        bbb::initialize(directory.path()).expect("initialize vault");

        let mut options = ServeOptions::new(directory.path());
        configure(&mut options);
        let daemon = Daemon::open(&options).expect("open daemon");
        Self { daemon, directory }
    }

    /// Opens a *second* daemon over the same directory, for restart tests.
    ///
    /// The caller must have dropped the first one; the vault admits one writer.
    pub(crate) fn reopen(directory: TempDir) -> Self {
        let options = ServeOptions::new(directory.path());
        let daemon = Daemon::open(&options).expect("reopen daemon");
        Self { daemon, directory }
    }

    /// The vault root on disk.
    pub(crate) fn root(&self) -> &Path {
        self.directory.path()
    }

    /// Takes ownership of the temporary directory, keeping it alive.
    pub(crate) fn into_directory(self) -> TempDir {
        // Dropping the daemon first releases the vault lock.
        let Self {
            daemon, directory, ..
        } = self;
        drop(daemon);
        directory
    }

    /// The daemon, for the few tests that need more than HTTP.
    pub(crate) fn daemon(&self) -> &Daemon {
        &self.daemon
    }

    /// Sends a request and reads the whole response.
    pub(crate) async fn send(&self, request: Request<Body>) -> Response {
        let response = self
            .daemon
            .router()
            .oneshot(request)
            .await
            .expect("the router is infallible");

        let status = response.status();
        let headers = response.headers().clone();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .expect("read body");
        Response {
            status,
            headers,
            body: bytes.to_vec(),
        }
    }

    /// `GET path`.
    pub(crate) async fn get(&self, path: &str) -> Response {
        self.send(
            request("GET", path)
                .body(Body::empty())
                .expect("build request"),
        )
        .await
    }

    /// `POST path` with a JSON body.
    pub(crate) async fn post(&self, path: &str, body: &Value) -> Response {
        self.send(json_request("POST", path, body)).await
    }

    /// `PATCH path` with a JSON body.
    pub(crate) async fn patch(&self, path: &str, body: &Value) -> Response {
        self.send(json_request("PATCH", path, body)).await
    }

    /// `DELETE path`.
    pub(crate) async fn delete(&self, path: &str) -> Response {
        self.send(
            request("DELETE", path)
                .body(Body::empty())
                .expect("build request"),
        )
        .await
    }

    /// The vault root's entry id, which every create needs as a parent.
    pub(crate) async fn root_id(&self) -> String {
        let tree = self.get("/api/v1/tree").await.json();
        tree["tree"][0]["id"]
            .as_str()
            .expect("the root has an id")
            .to_owned()
    }

    /// The whole tree response.
    pub(crate) async fn tree(&self) -> Value {
        self.get("/api/v1/tree").await.json()
    }

    /// The current generation from `/health`.
    pub(crate) async fn generation(&self) -> u64 {
        self.get("/api/v1/health").await.json()["generation"]
            .as_u64()
            .expect("health reports a generation")
    }

    /// Creates a bookmark and returns its DTO, asserting the status.
    pub(crate) async fn create_bookmark(&self, parent: &str, title: &str, url: &str) -> Value {
        let response = self
            .post(
                "/api/v1/bookmarks",
                &serde_json::json!({ "parentId": parent, "title": title, "url": url }),
            )
            .await;
        assert_eq!(response.status, StatusCode::CREATED, "{}", response.text());
        response.json()
    }

    /// Creates a folder and returns its DTO, asserting the status.
    pub(crate) async fn create_folder(&self, parent: &str, title: &str) -> Value {
        let response = self
            .post(
                "/api/v1/folders",
                &serde_json::json!({ "parentId": parent, "title": title }),
            )
            .await;
        assert_eq!(response.status, StatusCode::CREATED, "{}", response.text());
        response.json()
    }
}

/// A response, read into memory.
pub(crate) struct Response {
    pub(crate) status: StatusCode,
    pub(crate) headers: HeaderMap,
    pub(crate) body: Vec<u8>,
}

impl Response {
    /// The body as JSON.
    pub(crate) fn json(&self) -> Value {
        serde_json::from_slice(&self.body)
            .unwrap_or_else(|error| panic!("body is not JSON ({error}): {}", self.text()))
    }

    /// The body as text, for assertion messages.
    pub(crate) fn text(&self) -> String {
        String::from_utf8_lossy(&self.body).into_owned()
    }

    /// The `Content-Type`, or an empty string.
    pub(crate) fn content_type(&self) -> String {
        self.headers
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned()
    }

    /// Asserts this is a problem document with `code`, and returns it.
    pub(crate) fn expect_problem(&self, status: StatusCode, code: &str) -> Value {
        assert_eq!(self.status, status, "body: {}", self.text());
        assert_eq!(
            self.content_type(),
            "application/problem+json",
            "body: {}",
            self.text()
        );
        let json = self.json();
        assert_eq!(json["code"], code, "body: {}", self.text());
        assert_eq!(json["status"], status.as_u16(), "body: {}", self.text());
        assert!(
            json["detail"].as_str().is_some_and(|d| !d.is_empty()),
            "a problem must explain itself: {}",
            self.text()
        );
        json
    }
}

fn request(method: &str, path: &str) -> axum::http::request::Builder {
    Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, TEST_HOST)
}

fn json_request(method: &str, path: &str, body: &Value) -> Request<Body> {
    request(method, path)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(body.to_string()))
        .expect("build request")
}

/// Finds a node anywhere in a tree response by its id.
pub(crate) fn find_node<'a>(tree: &'a Value, id: &str) -> Option<&'a Value> {
    fn walk<'a>(node: &'a Value, id: &str) -> Option<&'a Value> {
        if node["id"] == id {
            return Some(node);
        }
        node["children"]
            .as_array()?
            .iter()
            .find_map(|child| walk(child, id))
    }
    tree["tree"]
        .as_array()?
        .iter()
        .find_map(|root| walk(root, id))
}

/// Every file in the vault, as (vault-relative path, bytes), sorted.
///
/// Used to prove that an operation changed nothing it was not asked to change.
pub(crate) fn vault_files(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut out = Vec::new();
    collect(root, root, &mut out);
    out.sort_by(|left, right| left.0.cmp(&right.0));
    out
}

fn collect(root: &Path, directory: &Path, out: &mut Vec<(String, Vec<u8>)>) {
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // `.bbb` holds the daemon's lock, not vault content.
        if path.file_name().is_some_and(|name| name == ".bbb") {
            continue;
        }
        if path.is_dir() {
            collect(root, &path, out);
        } else if let Ok(bytes) = fs::read(&path) {
            let relative = path
                .strip_prefix(root)
                .expect("inside the vault")
                .to_string_lossy()
                .replace('\\', "/");
            out.push((relative, bytes));
        }
    }
}

/// Writes a file into the vault the way an external editor would.
pub(crate) fn write_external(root: &Path, relative: &str, contents: &str) -> PathBuf {
    let path = root.join(relative);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent");
    }
    fs::write(&path, contents).expect("write file");
    path
}

/// A bookmark file body that parses but is refused for writing, because a
/// bookmark with no URL is not something the format can represent.
pub(crate) const MALFORMED_BOOKMARK: &str = "---\nbbb_id: aaaabbbb\nbbb_url:\nbbb_title: Broken\nbbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\nBody.\n";
