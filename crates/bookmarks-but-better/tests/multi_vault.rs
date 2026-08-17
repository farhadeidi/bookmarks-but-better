//! The multi-Vault contract: discovery, scoping, and the legacy routes'
//! single-Vault compatibility.
//!
//! Every test here drives the real router over at least two hosted Vaults, so
//! what is asserted is the HTTP contract ADR-0001 promised: vault-scoped
//! operations name their target, unscoped operations are a `vault_required`
//! error rather than a hidden default, and one Vault's change is never visible
//! through another Vault's routes.

mod support;

use std::fs;

use axum::body::Body;
use axum::http::StatusCode;
use axum::http::header;
use bookmarks_but_better::{Daemon, ServeOptions, VaultSpec};
use serde_json::json;
use support::{Harness, respond, test_request};

/// A daemon hosting two initialized Vaults, plus the directories that outlive
/// it (the daemon must be dropped to release the locks first).
struct MultiVault {
    daemon: Daemon,
    _a: tempfile::TempDir,
    _b: tempfile::TempDir,
}

/// The two ids every test here uses.
const A: &str = "reading";
const B: &str = "archive";

fn multi_vault() -> MultiVault {
    let a = tempfile::tempdir().expect("temp dir a");
    let b = tempfile::tempdir().expect("temp dir b");
    bookmarks_but_better::initialize(a.path()).expect("initialize a");
    bookmarks_but_better::initialize(b.path()).expect("initialize b");

    let options = ServeOptions {
        vaults: vec![VaultSpec::new(A, a.path()), VaultSpec::new(B, b.path())],
        ..ServeOptions::default()
    };
    let daemon = Daemon::open(&options).expect("open multi-vault daemon");
    MultiVault {
        daemon,
        _a: a,
        _b: b,
    }
}

impl MultiVault {
    async fn get(&self, path: &str) -> support::Response {
        respond(
            &self.daemon,
            test_request("GET", path)
                .body(Body::empty())
                .expect("build request"),
        )
        .await
    }

    async fn tree(&self, vault: &str) -> serde_json::Value {
        self.get(&format!("/api/v1/vaults/{vault}/tree"))
            .await
            .json()
    }

    /// Creates a bookmark through the vault-scoped route.
    async fn create(&self, vault: &str, parent: &str, title: &str, url: &str) -> support::Response {
        respond(
            &self.daemon,
            test_request("POST", &format!("/api/v1/vaults/{vault}/bookmarks"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    json!({ "parentId": parent, "title": title, "url": url }).to_string(),
                ))
                .expect("build request"),
        )
        .await
    }

    async fn root_id(&self, vault: &str) -> String {
        let tree = self.tree(vault).await;
        tree["tree"][0]["id"].as_str().expect("root id").to_owned()
    }
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

#[tokio::test]
async fn discovery_lists_every_hosted_vault_with_a_name() {
    let daemon = multi_vault();
    let response = daemon.get("/api/v1/vaults").await;

    assert_eq!(response.status, StatusCode::OK);
    let body = response.json();
    let vaults = body["vaults"].as_array().expect("a list of vaults");
    assert_eq!(vaults.len(), 2, "both configured vaults are listed");
    assert_eq!(vaults[0]["id"], A);
    assert_eq!(vaults[1]["id"], B);
    for vault in vaults {
        assert!(
            vault["name"].as_str().is_some_and(|name| !name.is_empty()),
            "every vault carries a display name: {vault}"
        );
    }
}

#[tokio::test]
async fn daemon_health_lists_the_vaults_and_omits_vault_specific_fields() {
    let daemon = multi_vault();
    let response = daemon.get("/api/v1/health").await;

    assert_eq!(response.status, StatusCode::OK);
    let body = response.json();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["vaults"].as_array().expect("vault summaries").len(), 2);
    assert!(
        body.get("generation").is_none(),
        "no single generation can speak for two vaults: {body}"
    );
    assert!(
        body.get("warnings").is_none(),
        "no single warning list can speak for two vaults: {body}"
    );
}

#[tokio::test]
async fn vault_scoped_health_keeps_the_legacy_shape() {
    let daemon = multi_vault();
    let response = daemon.get(&format!("/api/v1/vaults/{A}/health")).await;

    assert_eq!(response.status, StatusCode::OK);
    let body = response.json();
    assert_eq!(body["status"], "ok");
    assert!(body["generation"].as_u64().is_some(), "{body}");
    assert!(body["warnings"].as_array().is_some(), "{body}");
}

// ---------------------------------------------------------------------------
// Scoping
// ---------------------------------------------------------------------------

#[tokio::test]
async fn each_vaults_tree_only_lists_its_own_entries() {
    let daemon = multi_vault();
    let root_a = daemon.root_id(A).await;
    let root_b = daemon.root_id(B).await;

    let created = daemon
        .create(A, &root_a, "Only In Reading", "https://reading.example")
        .await;
    assert_eq!(created.status, StatusCode::CREATED, "{}", created.text());

    let tree_a = daemon.tree(A).await;
    let tree_b = daemon.tree(B).await;
    let a_titles: Vec<&str> = tree_a["tree"][0]["children"]
        .as_array()
        .expect("children")
        .iter()
        .map(|child| child["title"].as_str().expect("title"))
        .collect();
    assert!(a_titles.contains(&"Only In Reading"), "{a_titles:?}");
    assert!(
        tree_b["tree"][0]["children"]
            .as_array()
            .expect("children")
            .is_empty(),
        "a write through one vault's route never appears in another's tree"
    );
    let _ = root_b;
}

#[tokio::test]
async fn an_unknown_vault_id_is_a_stable_not_found_problem() {
    let daemon = multi_vault();
    let response = daemon.get("/api/v1/vaults/nope/tree").await;

    response.expect_problem(StatusCode::NOT_FOUND, "unknown_vault");
}

#[tokio::test]
async fn unscoped_vault_routes_answer_vault_required_when_several_are_hosted() {
    let daemon = multi_vault();

    for path in ["/api/v1/tree", "/api/v1/search?q=x"] {
        let response = daemon.get(path).await;
        let problem = response.expect_problem(StatusCode::BAD_REQUEST, "vault_required");
        // The error names the fix rather than leaving the client to guess.
        let detail = problem["detail"].as_str().expect("detail");
        assert!(detail.contains("/vaults/"), "{detail}");
    }
}

#[tokio::test]
async fn unscoped_routes_still_work_when_exactly_one_vault_is_hosted() {
    // One daemon, one vault: the legacy contract, unchanged.
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    harness
        .create_bookmark(&root_id, "Legacy Client", "https://legacy.example")
        .await;

    let tree = harness.tree().await;
    let titles: Vec<&str> = tree["tree"][0]["children"]
        .as_array()
        .expect("children")
        .iter()
        .map(|child| child["title"].as_str().expect("title"))
        .collect();
    assert!(titles.contains(&"Legacy Client"), "{titles:?}");

    // And the daemon-level health still carries the legacy fields, so a
    // single-vault client reads exactly what it always read.
    let health = harness.get("/api/v1/health").await.json();
    assert!(health["generation"].as_u64().is_some(), "{health}");
    assert!(health["warnings"].as_array().is_some(), "{health}");
}

#[tokio::test]
async fn vault_scoped_routes_also_work_for_a_single_vault_daemon() {
    let harness = Harness::new();
    let response = harness
        .get(&format!(
            "/api/v1/vaults/{}/tree",
            bookmarks_but_better::DEFAULT_VAULT_ID
        ))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());
}

// ---------------------------------------------------------------------------
// Configuration validation
// ---------------------------------------------------------------------------

#[test]
fn duplicate_vault_ids_fail_startup_without_opening_anything() {
    let a = tempfile::tempdir().expect("temp dir a");
    let b = tempfile::tempdir().expect("temp dir b");
    bookmarks_but_better::initialize(a.path()).expect("initialize a");
    bookmarks_but_better::initialize(b.path()).expect("initialize b");

    let options = ServeOptions {
        vaults: vec![
            VaultSpec::new("same", a.path()),
            VaultSpec::new("same", b.path()),
        ],
        ..ServeOptions::default()
    };
    let error = Daemon::open(&options).expect_err("duplicate ids must fail");
    assert!(error.to_string().contains("same"), "{error}");
}

#[test]
fn overlapping_roots_fail_startup() {
    let outer = tempfile::tempdir().expect("temp dir");
    let inner = outer.path().join("inner");
    fs::create_dir_all(&inner).expect("create inner");
    bookmarks_but_better::initialize(outer.path()).expect("initialize outer");
    bookmarks_but_better::initialize(&inner).expect("initialize inner");

    let options = ServeOptions {
        vaults: vec![
            VaultSpec::new("outer", outer.path()),
            VaultSpec::new("inner", &inner),
        ],
        ..ServeOptions::default()
    };
    let error = Daemon::open(&options).expect_err("nested roots must fail");
    assert!(
        error.to_string().contains("overlap"),
        "the error names the problem: {error}"
    );
}

#[test]
fn startup_is_atomic_when_a_later_vault_cannot_open() {
    let good = tempfile::tempdir().expect("good dir");
    bookmarks_but_better::initialize(good.path()).expect("initialize good");
    let not_a_vault = tempfile::tempdir().expect("plain dir"); // never initialized

    let options = ServeOptions {
        vaults: vec![
            VaultSpec::new("good", good.path()),
            VaultSpec::new("bad", not_a_vault.path()),
        ],
        ..ServeOptions::default()
    };
    let error = Daemon::open(&options).expect_err("a bad vault fails the set");
    assert!(error.to_string().contains("bad"), "{error}");

    // Atomicity: the good vault's lock was taken and released again, so the
    // very same directory opens cleanly on the next attempt.
    drop(error);
    let retry = Daemon::open(&ServeOptions::new(good.path()));
    retry.expect("a failed startup holds no locks behind it");
}

#[test]
fn an_empty_configuration_is_refused() {
    let error = Daemon::open(&ServeOptions::default()).expect_err("no vaults configured");
    assert!(error.to_string().contains("no vault"), "{error}");
}
