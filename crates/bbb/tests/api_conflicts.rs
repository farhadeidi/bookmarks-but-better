//! Everything the API refuses, and the shape it refuses in.

mod support;

use axum::http::StatusCode;
use serde_json::json;
use support::{Harness, MALFORMED_BOOKMARK, find_node, vault_files, write_external};

#[tokio::test]
async fn a_stale_revision_is_a_conflict_and_never_an_overwrite() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let stale = created["revision"].as_str().expect("a revision").to_owned();

    // Somebody else edits the file first — an editor, a sync tool, anything.
    let path = harness.root().join(format!("React--{id}.md"));
    let external = std::fs::read_to_string(&path)
        .expect("read")
        .replace("bbb_title: React", "bbb_title: React (theirs)");
    std::fs::write(&path, &external).expect("write");
    harness.post("/api/v1/rescan", &json!({})).await;

    let response = harness
        .patch(
            &format!("/api/v1/bookmarks/{id}"),
            &json!({ "revision": stale, "title": "React (mine)" }),
        )
        .await;
    let problem = response.expect_problem(StatusCode::CONFLICT, "stale_revision");
    assert!(
        problem["detail"]
            .as_str()
            .expect("a detail")
            .contains("changed on disk"),
        "the detail must say what to do: {problem}"
    );

    assert_eq!(
        std::fs::read_to_string(&path).expect("read"),
        external,
        "the external edit must survive untouched"
    );
}

#[tokio::test]
async fn a_stale_revision_blocks_delete_and_move_too() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();

    let wrong = "0".repeat(64);
    harness
        .delete(&format!("/api/v1/bookmarks/{id}?revision={wrong}"))
        .await
        .expect_problem(StatusCode::CONFLICT, "stale_revision");
    harness
        .post(
            &format!("/api/v1/bookmarks/{id}/move"),
            &json!({ "revision": wrong, "parentId": folder_id }),
        )
        .await
        .expect_problem(StatusCode::CONFLICT, "stale_revision");

    assert!(
        harness.root().join(format!("React--{id}.md")).exists(),
        "a refused mutation changes nothing"
    );
}

#[tokio::test]
async fn a_malformed_bookmark_is_read_only_with_actionable_diagnostics() {
    let harness = Harness::new();
    write_external(harness.root(), "Broken--aaaabbbb.md", MALFORMED_BOOKMARK);
    harness.post("/api/v1/rescan", &json!({})).await;

    let tree = harness.tree().await;
    let node = find_node(&tree, "aaaabbbb").expect("the broken bookmark is still visible");
    assert_eq!(
        node["readOnly"], true,
        "a bookmark that cannot be written says so: {node}"
    );
    let diagnostics = node["diagnostics"].as_array().expect("diagnostics");
    assert!(
        diagnostics.iter().any(
            |diagnostic| diagnostic["code"] == "empty_url" && diagnostic["severity"] == "error"
        ),
        "the diagnostic names the problem: {node}"
    );

    // It is surfaced at the vault level too, so a UI can show a banner.
    let warnings = harness.get("/api/v1/health").await.json()["warnings"]
        .as_array()
        .expect("warnings")
        .clone();
    assert!(
        warnings
            .iter()
            .any(|warning| warning["code"] == "empty_url")
    );

    // And every write to it is refused, with the file left exactly as it was.
    let before = vault_files(harness.root());
    let revision = node["revision"].as_str().expect("a revision");
    harness
        .patch(
            "/api/v1/bookmarks/aaaabbbb",
            &json!({ "revision": revision, "title": "Fixed" }),
        )
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "read_only");
    assert_eq!(vault_files(harness.root()), before);
}

#[tokio::test]
async fn a_directory_without_metadata_is_visible_but_not_writable() {
    let harness = Harness::new();
    write_external(
        harness.root(),
        "Archive/Notes--ccccdddd.md",
        "---\nbbb_id: ccccdddd\nbbb_url: https://example.com\nbbb_title: Notes\n\
         bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\n",
    );
    harness.post("/api/v1/rescan", &json!({})).await;

    let tree = harness.tree().await;
    let directory = find_node(&tree, "!Archive").expect("the directory is shown");
    assert_eq!(directory["title"], "Archive");
    assert_eq!(directory["readOnly"], true);
    assert!(
        directory.get("revision").is_none(),
        "with no metadata file there is no revision: {directory}"
    );
    assert!(
        directory["diagnostics"]
            .as_array()
            .expect("diagnostics")
            .iter()
            .any(|diagnostic| diagnostic["code"] == "missing_folder_metadata"),
        "{directory}"
    );

    // The bookmark inside it is still fully visible.
    let bookmark = find_node(&tree, "ccccdddd").expect("the bookmark is not hidden");
    assert_eq!(bookmark["parentId"], "!Archive");
    assert_eq!(bookmark["url"], "https://example.com");

    // But nothing may be created inside a directory with no stable identity.
    harness
        .post(
            "/api/v1/bookmarks",
            &json!({ "parentId": "!Archive", "title": "New", "url": "https://example.org" }),
        )
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "read_only");
}

#[tokio::test]
async fn two_entries_claiming_one_identity_are_ambiguous() {
    let harness = Harness::new();
    let body = "---\nbbb_id: eeeeffff\nbbb_url: https://example.com\nbbb_title: Twin\n\
                bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\n";
    write_external(harness.root(), "Twin--eeeeffff.md", body);
    write_external(harness.root(), "Copy--eeeeffff.md", body);
    harness.post("/api/v1/rescan", &json!({})).await;

    let response = harness.get("/api/v1/bookmarks/eeeeffff").await;
    let problem = response.expect_problem(StatusCode::CONFLICT, "ambiguous_id");
    assert!(
        problem["detail"].as_str().expect("a detail").contains('2'),
        "the detail says how many claim it: {problem}"
    );

    // Both copies are read-only, so neither can be written by accident.
    let tree = harness.tree().await;
    let claimants: Vec<&serde_json::Value> = tree["tree"][0]["children"]
        .as_array()
        .expect("children")
        .iter()
        .filter(|child| child["id"] == "eeeeffff")
        .collect();
    assert_eq!(claimants.len(), 2);
    assert!(claimants.iter().all(|node| node["readOnly"] == true));
}

#[tokio::test]
async fn a_folder_cannot_be_moved_into_itself() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let outer = harness.create_folder(&root_id, "Outer").await;
    let outer_id = outer["id"].as_str().expect("an id").to_owned();
    let outer_revision = outer["revision"].as_str().expect("a revision").to_owned();
    let inner = harness.create_folder(&outer_id, "Inner").await;
    let inner_id = inner["id"].as_str().expect("an id").to_owned();

    for destination in [&outer_id, &inner_id] {
        harness
            .post(
                &format!("/api/v1/bookmarks/{outer_id}/move"),
                &json!({ "revision": outer_revision, "parentId": destination }),
            )
            .await
            .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "move_into_self");
    }
    assert!(harness.root().join("Outer").join("Inner").is_dir());
}

#[tokio::test]
async fn the_vault_root_cannot_be_deleted_or_moved() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let tree = harness.tree().await;
    let revision = tree["tree"][0]["revision"]
        .as_str()
        .expect("a revision")
        .to_owned();
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();

    harness
        .delete(&format!(
            "/api/v1/folders/{root_id}?revision={revision}&recursive=true"
        ))
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "invalid_value");
    harness
        .post(
            &format!("/api/v1/bookmarks/{root_id}/move"),
            &json!({ "revision": revision, "parentId": folder_id }),
        )
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "invalid_value");

    assert!(harness.root().join(".bbb-folder.md").is_file());
}

#[tokio::test]
async fn malformed_requests_are_refused_before_anything_is_written() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let revision = created["revision"].as_str().expect("a revision").to_owned();
    let before = vault_files(harness.root());

    // An id that is not an id.
    harness
        .get("/api/v1/bookmarks/not-an-id")
        .await
        .expect_problem(StatusCode::BAD_REQUEST, "invalid_request");
    // A revision that is not a revision.
    harness
        .patch(
            &format!("/api/v1/bookmarks/{id}"),
            &json!({ "revision": "nope", "title": "x" }),
        )
        .await
        .expect_problem(StatusCode::BAD_REQUEST, "invalid_request");
    // A body missing the required revision.
    harness
        .patch(&format!("/api/v1/bookmarks/{id}"), &json!({ "title": "x" }))
        .await
        .expect_problem(StatusCode::BAD_REQUEST, "invalid_request");
    // A delete with no revision at all.
    harness
        .delete(&format!("/api/v1/bookmarks/{id}"))
        .await
        .expect_problem(StatusCode::BAD_REQUEST, "invalid_request");
    // An empty title.
    harness
        .patch(
            &format!("/api/v1/bookmarks/{id}"),
            &json!({ "revision": revision, "title": "   " }),
        )
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "invalid_value");
    // A url on a folder.
    harness
        .patch(
            &format!("/api/v1/bookmarks/{root_id}"),
            &json!({ "revision": revision, "url": "https://example.com" }),
        )
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "invalid_value");
    // An id that simply is not there.
    harness
        .get("/api/v1/bookmarks/zzzzzzzz")
        .await
        .expect_problem(StatusCode::NOT_FOUND, "not_found");

    assert_eq!(
        vault_files(harness.root()),
        before,
        "no refused request may touch the vault"
    );
}

#[tokio::test]
async fn deleting_a_folder_through_the_bookmark_route_is_refused() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let revision = folder["revision"].as_str().expect("a revision").to_owned();

    harness
        .delete(&format!(
            "/api/v1/bookmarks/{folder_id}?revision={revision}"
        ))
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "invalid_value");
    assert!(harness.root().join("Dev").is_dir());
}
