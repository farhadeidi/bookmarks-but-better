//! Create, read, update, delete and move, round-tripped through Markdown.

mod support;

use axum::http::StatusCode;
use bbb_vault_core::FOLDER_FILE_NAME;
use serde_json::json;
use support::{Harness, find_node, vault_files};

#[tokio::test]
async fn health_reports_a_version_and_a_generation() {
    let harness = Harness::new();
    let response = harness.get("/api/v1/health").await;

    assert_eq!(response.status, StatusCode::OK);
    let body = response.json();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
    assert!(body["generation"].as_u64().is_some_and(|value| value > 0));
    assert_eq!(
        body["warnings"].as_array().map(Vec::len),
        Some(0),
        "a freshly initialized vault has nothing to warn about"
    );
}

#[tokio::test]
async fn the_tree_is_a_single_root_holding_its_children() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;

    let tree = harness.tree().await;
    let roots = tree["tree"].as_array().expect("tree is a list");
    assert_eq!(roots.len(), 1, "there is exactly one root");
    assert_eq!(roots[0]["id"], root_id);
    assert!(
        roots[0].get("parentId").is_none(),
        "the root has no parent: {}",
        roots[0]
    );
    assert!(
        roots[0]["children"]
            .as_array()
            .expect("children")
            .is_empty()
    );
    assert!(
        roots[0].get("url").is_none(),
        "a folder has no url: {}",
        roots[0]
    );
}

#[tokio::test]
async fn a_created_bookmark_round_trips_through_markdown() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;

    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();

    assert_eq!(created["title"], "React");
    assert_eq!(created["url"], "https://react.dev");
    assert_eq!(created["parentId"], root_id);
    assert!(created["revision"].as_str().is_some());
    assert!(
        created["dateAdded"].as_i64().is_some(),
        "dateAdded is epoch milliseconds: {created}"
    );
    assert!(
        created.get("readOnly").is_none(),
        "a healthy bookmark is writable: {created}"
    );

    // The file on disk is the source of truth, and it is readable Markdown.
    let files = vault_files(harness.root());
    let (path, bytes) = files
        .iter()
        .find(|(path, _)| path.contains("--") && path != FOLDER_FILE_NAME)
        .expect("a bookmark file exists");
    let text = String::from_utf8(bytes.clone()).expect("utf-8");
    assert!(
        path.ends_with(&format!("--{id}.md")),
        "the filename carries the identity: {path}"
    );
    assert!(text.contains("bbb_url: https://react.dev"), "{text}");
    assert!(text.contains("bbb_title: React"), "{text}");

    // And it comes back the same way through both read routes.
    let fetched = harness.get(&format!("/api/v1/bookmarks/{id}")).await.json();
    assert_eq!(fetched["url"], "https://react.dev");
    let tree = harness.tree().await;
    assert_eq!(find_node(&tree, &id).expect("in tree")["title"], "React");
}

#[tokio::test]
async fn a_url_less_create_makes_a_folder() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;

    let state = harness
        .state_revision(&root_id)
        .await
        .expect("an initialized root has a child order file");
    let response = harness
        .post(
            "/api/v1/bookmarks",
            &json!({ "parentId": root_id, "title": "Dev", "parentStateRevision": state }),
        )
        .await;
    assert_eq!(response.status, StatusCode::CREATED, "{}", response.text());

    let created = response.json();
    assert!(
        created["children"].as_array().is_some_and(Vec::is_empty),
        "a folder has children: {created}"
    );
    assert!(created.get("url").is_none(), "{created}");
    assert!(
        harness.root().join("Dev").join(FOLDER_FILE_NAME).is_file(),
        "the folder has its own metadata file"
    );
}

#[tokio::test]
async fn a_title_edit_keeps_the_id_and_every_unknown_byte() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();

    // An external editor adds content the daemon knows nothing about.
    let path = harness.root().join(format!("React--{id}.md"));
    let original = std::fs::read_to_string(&path).expect("read");
    // Reopen the front matter, add a key the daemon has never heard of, and
    // give the file a body.
    let enriched = format!(
        "{}tags: [a, b]  # kept\n---\nMy own notes.\n",
        original.trim_end_matches("---\n")
    );
    std::fs::write(&path, &enriched).expect("write");
    harness.post("/api/v1/rescan", &json!({})).await;

    let before = harness.get(&format!("/api/v1/bookmarks/{id}")).await.json();
    let revision = before["revision"].as_str().expect("a revision").to_owned();

    let updated = harness
        .patch(
            &format!("/api/v1/bookmarks/{id}"),
            &json!({ "revision": revision, "title": "React 19" }),
        )
        .await;
    assert_eq!(updated.status, StatusCode::OK, "{}", updated.text());
    assert_eq!(
        updated.json()["id"],
        id,
        "a title edit never changes the id"
    );
    assert_eq!(updated.json()["title"], "React 19");

    let after = std::fs::read_to_string(&path).expect("read");
    assert!(
        after.contains("tags: [a, b]  # kept"),
        "unknown front matter survives: {after}"
    );
    assert!(
        after.contains("My own notes."),
        "the body survives: {after}"
    );
    assert!(after.contains("bbb_title: React 19"), "{after}");
    assert!(
        after.contains(&format!("bbb_id: {id}")),
        "the identity is untouched: {after}"
    );
}

#[tokio::test]
async fn a_no_op_update_leaves_every_byte_alone() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id");
    let revision = created["revision"].as_str().expect("a revision");

    let before = vault_files(harness.root());
    let response = harness
        .patch(
            &format!("/api/v1/bookmarks/{id}"),
            &json!({ "revision": revision, "title": "React", "url": "https://react.dev" }),
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());

    assert_eq!(
        vault_files(harness.root()),
        before,
        "an update that changes nothing must not rewrite a single byte"
    );
    assert_eq!(
        response.json()["revision"],
        revision,
        "the revision is unchanged too"
    );
}

#[tokio::test]
async fn a_move_preserves_the_identity_and_the_bytes() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let revision = created["revision"].as_str().expect("a revision").to_owned();

    let source = harness.root().join(format!("React--{id}.md"));
    let bytes_before = std::fs::read(&source).expect("read");

    let response = harness
        .move_entry(&id, &revision, &root_id, &folder_id, None)
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());

    let moved = response.json();
    assert_eq!(moved["id"], id, "a move never changes the id");
    assert_eq!(moved["parentId"], folder_id);
    assert_eq!(
        moved["revision"], revision,
        "a move does not touch the file's contents"
    );

    assert!(!source.exists(), "the old path is gone");
    let destination = harness.root().join("Dev").join(format!("React--{id}.md"));
    assert_eq!(
        std::fs::read(&destination).expect("read"),
        bytes_before,
        "the moved file is byte-identical"
    );

    // And it is addressable by the same id afterwards.
    let fetched = harness.get(&format!("/api/v1/bookmarks/{id}")).await;
    assert_eq!(fetched.status, StatusCode::OK);
    assert_eq!(fetched.json()["parentId"], folder_id);
}

#[tokio::test]
async fn a_deleted_bookmark_is_gone_from_disk_and_from_the_tree() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let created = harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;
    let id = created["id"].as_str().expect("an id").to_owned();
    let revision = created["revision"].as_str().expect("a revision").to_owned();

    let response = harness
        .delete_entry("bookmarks", &id, &revision, &root_id, "")
        .await;
    assert_eq!(
        response.status,
        StatusCode::NO_CONTENT,
        "{}",
        response.text()
    );

    assert!(!harness.root().join(format!("React--{id}.md")).exists());
    harness
        .get(&format!("/api/v1/bookmarks/{id}"))
        .await
        .expect_problem(StatusCode::NOT_FOUND, "not_found");
    let tree = harness.tree().await;
    assert!(find_node(&tree, &id).is_none());
}

#[tokio::test]
async fn an_empty_folder_deletes_and_a_full_one_needs_the_explicit_request() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;

    let empty = harness.create_folder(&root_id, "Empty").await;
    let empty_id = empty["id"].as_str().expect("an id").to_owned();
    let empty_revision = empty["revision"].as_str().expect("a revision").to_owned();

    let full = harness.create_folder(&root_id, "Full").await;
    let full_id = full["id"].as_str().expect("an id").to_owned();
    let full_revision = full["revision"].as_str().expect("a revision").to_owned();
    harness
        .create_bookmark(&full_id, "React", "https://react.dev")
        .await;

    let response = harness
        .delete_entry("folders", &empty_id, &empty_revision, &root_id, "")
        .await;
    assert_eq!(
        response.status,
        StatusCode::NO_CONTENT,
        "{}",
        response.text()
    );
    assert!(!harness.root().join("Empty").exists());

    let refused = harness
        .delete_entry("folders", &full_id, &full_revision, &root_id, "")
        .await;
    refused.expect_problem(StatusCode::CONFLICT, "folder_not_empty");
    assert!(
        harness.root().join("Full").exists(),
        "a refused delete removes nothing"
    );

    let accepted = harness
        .delete_entry(
            "folders",
            &full_id,
            &full_revision,
            &root_id,
            "&recursive=true",
        )
        .await;
    assert_eq!(
        accepted.status,
        StatusCode::NO_CONTENT,
        "{}",
        accepted.text()
    );
    assert!(!harness.root().join("Full").exists());
}

#[tokio::test]
async fn the_tree_survives_a_restart_and_a_rescan() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    let folder = harness.create_folder(&root_id, "Dev").await;
    let folder_id = folder["id"].as_str().expect("an id").to_owned();
    let bookmark = harness
        .create_bookmark(&folder_id, "React", "https://react.dev")
        .await;
    let bookmark_id = bookmark["id"].as_str().expect("an id").to_owned();

    let before = harness.tree().await;
    let files_before = vault_files(harness.root());

    // Restart: drop the daemon, release the lock, open a fresh one.
    let directory = harness.into_directory();
    let harness = Harness::reopen(directory);

    let after = harness.tree().await;
    assert_eq!(
        after, before,
        "a restart reconstructs exactly the same tree"
    );
    assert_eq!(
        vault_files(harness.root()),
        files_before,
        "opening a vault writes nothing"
    );

    let rescan = harness.post("/api/v1/rescan", &json!({})).await;
    assert_eq!(rescan.status, StatusCode::OK, "{}", rescan.text());
    assert_eq!(
        rescan.json()["changed"],
        false,
        "a rescan of an unchanged vault reports no change"
    );

    assert_eq!(harness.tree().await, before);
    for id in [&folder_id, &bookmark_id] {
        assert_eq!(
            harness.get(&format!("/api/v1/bookmarks/{id}")).await.status,
            StatusCode::OK,
            "identity {id} survived the restart"
        );
    }
}

#[tokio::test]
async fn siblings_come_back_in_a_deterministic_order() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;

    harness
        .create_bookmark(&root_id, "zebra", "https://z")
        .await;
    harness
        .create_bookmark(&root_id, "Apple", "https://a")
        .await;
    harness.create_folder(&root_id, "Tools").await;
    harness.create_folder(&root_id, "archive").await;

    let tree = harness.tree().await;
    let titles: Vec<&str> = tree["tree"][0]["children"]
        .as_array()
        .expect("children")
        .iter()
        .map(|child| child["title"].as_str().expect("a title"))
        .collect();

    assert_eq!(
        titles,
        vec!["zebra", "Apple", "Tools", "archive"],
        "a create appends, so the tree comes back in the order things were made"
    );
}
