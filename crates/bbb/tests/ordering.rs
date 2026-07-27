//! Manual child ordering over the HTTP API.
//!
//! Everything here goes through the real router, so what is asserted is the
//! contract a client sees: which requests are accepted, what the tree comes
//! back looking like, and what is on disk afterwards.

mod support;

use std::fs;

use axum::http::StatusCode;
use bbb_vault_core::STATE_FILE_NAME;
use serde_json::json;

use support::{Harness, find_node, vault_files, write_external};

/// A root holding, in creation order: two bookmarks and two folders.
///
/// Returns the root id and the four child ids in that order.
async fn populated(harness: &Harness) -> (String, [String; 4]) {
    let root = harness.root_id().await;
    let one = harness
        .create_bookmark(&root, "One", "https://one.example")
        .await;
    let two = harness
        .create_bookmark(&root, "Two", "https://two.example")
        .await;
    let dev = harness.create_folder(&root, "Dev").await;
    let ops = harness.create_folder(&root, "Ops").await;
    let id = |value: &serde_json::Value| value["id"].as_str().expect("an id").to_owned();
    (root, [id(&one), id(&two), id(&dev), id(&ops)])
}

/// Borrows a list of owned ids so it can be compared with `child_ids`.
fn refs<'a>(ids: &[&'a String]) -> Vec<&'a str> {
    ids.iter().map(|id| id.as_str()).collect()
}

fn state_path(harness: &Harness, relative: &str) -> std::path::PathBuf {
    if relative.is_empty() {
        harness.root().join(STATE_FILE_NAME)
    } else {
        harness.root().join(relative).join(STATE_FILE_NAME)
    }
}

// -- what init and create establish ---------------------------------------

#[tokio::test]
async fn an_initialized_root_has_a_child_order_file_and_exposes_its_revision() {
    let harness = Harness::new();
    let root = harness.root_id().await;

    let path = state_path(&harness, "");
    assert!(path.is_file(), "init writes the root's order file");
    assert_eq!(
        fs::read_to_string(&path).expect("read"),
        "{\n  \"version\": 1,\n  \"children\": []\n}\n",
        "canonical pretty JSON with a final newline"
    );

    let tree = harness.tree().await;
    let node = find_node(&tree, &root).expect("the root");
    assert!(
        node["stateRevision"].as_str().is_some(),
        "the folder DTO carries the revision a client sends back: {node}"
    );
    assert!(
        node.get("orderReadOnly").is_none(),
        "a canonical order file is writable"
    );
}

#[tokio::test]
async fn a_new_folder_gets_its_own_order_file_immediately() {
    let harness = Harness::new();
    let root = harness.root_id().await;
    harness.create_folder(&root, "Dev").await;

    assert_eq!(
        fs::read_to_string(state_path(&harness, "Dev")).expect("read"),
        "{\n  \"version\": 1,\n  \"children\": []\n}\n",
        "so the first child put into it can be placed without a migration first"
    );
}

#[tokio::test]
async fn a_create_appends_when_no_index_is_given() {
    let harness = Harness::new();
    let (root, ids) = populated(&harness).await;
    assert_eq!(harness.child_ids(&root).await, ids);
}

#[tokio::test]
async fn a_create_honours_every_index_from_zero_to_the_end() {
    for index in 0..=4 {
        let harness = Harness::new();
        let (root, ids) = populated(&harness).await;
        let created = harness
            .create_bookmark_at(&root, "New", "https://new.example", Some(index))
            .await;
        let new = created["id"].as_str().expect("an id").to_owned();

        let mut expected: Vec<String> = ids.to_vec();
        expected.insert(index, new);
        assert_eq!(harness.child_ids(&root).await, expected, "at index {index}");
    }
}

#[tokio::test]
async fn a_create_past_the_end_is_refused_and_writes_nothing() {
    let harness = Harness::new();
    let (root, _) = populated(&harness).await;
    let before = vault_files(harness.root());
    let state = harness.state_revision(&root).await.expect("a revision");

    harness
        .post(
            "/api/v1/bookmarks",
            &json!({
                "parentId": root, "title": "New", "url": "https://new.example",
                "index": 5, "parentStateRevision": state,
            }),
        )
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "invalid_order");

    assert_eq!(
        vault_files(harness.root()),
        before,
        "a refused create leaves no half-made entry behind"
    );
}

#[tokio::test]
async fn a_create_without_the_parents_order_revision_is_refused() {
    let harness = Harness::new();
    let root = harness.root_id().await;

    harness
        .post(
            "/api/v1/bookmarks",
            &json!({ "parentId": root, "title": "New", "url": "https://new.example" }),
        )
        .await
        .expect_problem(StatusCode::CONFLICT, "stale_state_revision");
}

#[tokio::test]
async fn a_create_with_a_stale_order_revision_is_refused() {
    let harness = Harness::new();
    let (root, _) = populated(&harness).await;

    harness
        .post(
            "/api/v1/bookmarks",
            &json!({
                "parentId": root, "title": "New", "url": "https://new.example",
                "parentStateRevision": "0".repeat(64),
            }),
        )
        .await
        .expect_problem(StatusCode::CONFLICT, "stale_state_revision");
}

// -- reordering ------------------------------------------------------------

#[tokio::test]
async fn a_reorder_interleaves_bookmarks_and_folders() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;

    let response = harness
        .set_order(
            &root,
            &[
                (&ops, "folder"),
                (&two, "bookmark"),
                (&dev, "folder"),
                (&one, "bookmark"),
            ],
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());

    assert_eq!(
        harness.child_ids(&root).await,
        refs(&[&ops, &two, &dev, &one])
    );
    let written = fs::read_to_string(state_path(&harness, "")).expect("read");
    assert!(
        written.find(&ops).unwrap() < written.find(&one).unwrap(),
        "the file records it too: {written}"
    );
}

#[tokio::test]
async fn a_reorder_survives_a_restart_and_a_rescan() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    harness
        .set_order(
            &root,
            &[
                (&ops, "folder"),
                (&two, "bookmark"),
                (&dev, "folder"),
                (&one, "bookmark"),
            ],
        )
        .await;
    let expected = harness.child_ids(&root).await;

    let harness = Harness::reopen(harness.into_directory());
    assert_eq!(harness.child_ids(&root).await, expected, "after a restart");

    harness.post("/api/v1/rescan", &json!({})).await;
    assert_eq!(harness.child_ids(&root).await, expected, "after a rescan");
}

#[tokio::test]
async fn reordering_into_the_order_it_is_already_in_writes_nothing() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    let before = vault_files(harness.root());
    let generation = harness.generation().await;
    let revision = harness.state_revision(&root).await;

    let response = harness
        .set_order(
            &root,
            &[
                (&one, "bookmark"),
                (&two, "bookmark"),
                (&dev, "folder"),
                (&ops, "folder"),
            ],
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());

    assert_eq!(
        vault_files(harness.root()),
        before,
        "a no-op reorder must be byte-identical"
    );
    assert_eq!(harness.generation().await, generation, "and silent");
    assert_eq!(harness.state_revision(&root).await, revision);
}

#[tokio::test]
async fn a_reorder_is_idempotent() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    let order = [
        (ops.as_str(), "folder"),
        (one.as_str(), "bookmark"),
        (ops.as_str(), "folder"),
        (dev.as_str(), "folder"),
    ];
    // Sent twice, with the second carrying the revision the first produced.
    let wanted = [
        (ops.as_str(), "folder"),
        (one.as_str(), "bookmark"),
        (dev.as_str(), "folder"),
        (two.as_str(), "bookmark"),
    ];
    let _ = order;

    harness.set_order(&root, &wanted).await;
    let after_first = vault_files(harness.root());
    let generation = harness.generation().await;

    let response = harness.set_order(&root, &wanted).await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());
    assert_eq!(vault_files(harness.root()), after_first);
    assert_eq!(harness.generation().await, generation);
}

#[tokio::test]
async fn a_reorder_must_name_every_child_exactly_once() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;

    for (label, children) in [
        (
            "one left out",
            vec![
                (one.as_str(), "bookmark"),
                (two.as_str(), "bookmark"),
                (dev.as_str(), "folder"),
            ],
        ),
        (
            "one named twice",
            vec![
                (one.as_str(), "bookmark"),
                (one.as_str(), "bookmark"),
                (dev.as_str(), "folder"),
                (ops.as_str(), "folder"),
            ],
        ),
        (
            "a stranger",
            vec![
                (one.as_str(), "bookmark"),
                (two.as_str(), "bookmark"),
                (dev.as_str(), "folder"),
                ("zzzzzzzz", "folder"),
            ],
        ),
        (
            "the wrong kind",
            vec![
                (one.as_str(), "bookmark"),
                (two.as_str(), "bookmark"),
                (dev.as_str(), "bookmark"),
                (ops.as_str(), "folder"),
            ],
        ),
    ] {
        let before = vault_files(harness.root());
        harness
            .set_order(&root, &children)
            .await
            .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "invalid_order");
        assert_eq!(
            vault_files(harness.root()),
            before,
            "{label}: a refused order writes nothing"
        );
    }
}

#[tokio::test]
async fn a_reorder_with_a_stale_order_revision_is_refused() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;

    harness
        .send_order(
            &root,
            Some(&"0".repeat(64)),
            &[
                (&ops, "folder"),
                (&one, "bookmark"),
                (&two, "bookmark"),
                (&dev, "folder"),
            ],
        )
        .await
        .expect_problem(StatusCode::CONFLICT, "stale_state_revision");
}

#[tokio::test]
async fn a_reorder_that_claims_there_is_no_order_file_is_refused() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;

    harness
        .send_order(
            &root,
            None,
            &[
                (&ops, "folder"),
                (&one, "bookmark"),
                (&two, "bookmark"),
                (&dev, "folder"),
            ],
        )
        .await
        .expect_problem(StatusCode::CONFLICT, "stale_state_revision");
}

#[tokio::test]
async fn two_unrelated_folders_are_ordered_independently() {
    let harness = Harness::new();
    let root = harness.root_id().await;
    let left = harness.create_folder(&root, "Left").await;
    let left_id = left["id"].as_str().expect("an id").to_owned();
    let right = harness.create_folder(&root, "Right").await;
    let right_id = right["id"].as_str().expect("an id").to_owned();

    let mut made = Vec::new();
    for parent in [&left_id, &right_id] {
        let first = harness
            .create_bookmark(parent, "First", "https://1.example")
            .await;
        let second = harness
            .create_bookmark(parent, "Second", "https://2.example")
            .await;
        made.push((
            first["id"].as_str().expect("an id").to_owned(),
            second["id"].as_str().expect("an id").to_owned(),
        ));
    }

    // Reversing one folder must leave the other exactly as it was.
    let (l1, l2) = made[0].clone();
    let (r1, r2) = made[1].clone();
    harness
        .set_order(&left_id, &[(&l2, "bookmark"), (&l1, "bookmark")])
        .await;

    assert_eq!(harness.child_ids(&left_id).await, refs(&[&l2, &l1]));
    assert_eq!(harness.child_ids(&right_id).await, refs(&[&r1, &r2]));

    harness
        .set_order(&right_id, &[(&r2, "bookmark"), (&r1, "bookmark")])
        .await;
    assert_eq!(harness.child_ids(&left_id).await, refs(&[&l2, &l1]));
    assert_eq!(harness.child_ids(&right_id).await, refs(&[&r2, &r1]));
}

// -- moving ----------------------------------------------------------------

#[tokio::test]
async fn a_move_inside_one_folder_lands_on_the_exact_index() {
    for index in 0..4 {
        let harness = Harness::new();
        let (root, ids) = populated(&harness).await;
        let entry = ids[0].clone();
        let revision = find_node(&harness.tree().await, &entry).expect("the entry")["revision"]
            .as_str()
            .expect("a revision")
            .to_owned();

        let response = harness
            .move_entry(&entry, &revision, &root, &root, Some(index))
            .await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text());

        let mut expected: Vec<String> = ids.iter().filter(|id| **id != entry).cloned().collect();
        expected.insert(index, entry);
        assert_eq!(harness.child_ids(&root).await, expected, "to index {index}");
    }
}

#[tokio::test]
async fn a_move_inside_one_folder_to_where_it_already_is_writes_nothing() {
    let harness = Harness::new();
    let (root, ids) = populated(&harness).await;
    let entry = ids[1].clone();
    let revision = find_node(&harness.tree().await, &entry).expect("the entry")["revision"]
        .as_str()
        .expect("a revision")
        .to_owned();
    let before = vault_files(harness.root());
    let generation = harness.generation().await;

    let response = harness
        .move_entry(&entry, &revision, &root, &root, Some(1))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());

    assert_eq!(
        vault_files(harness.root()),
        before,
        "no file moves and no byte changes"
    );
    assert_eq!(harness.generation().await, generation);
}

#[tokio::test]
async fn a_move_inside_one_folder_refuses_two_disagreeing_revisions() {
    let harness = Harness::new();
    let (root, ids) = populated(&harness).await;
    let entry = ids[0].clone();
    let revision = find_node(&harness.tree().await, &entry).expect("the entry")["revision"]
        .as_str()
        .expect("a revision")
        .to_owned();
    let state = harness.state_revision(&root).await.expect("a revision");

    harness
        .post(
            &format!("/api/v1/bookmarks/{entry}/move"),
            &json!({
                "revision": revision, "parentId": root, "index": 2,
                "sourceStateRevision": state, "destinationStateRevision": "0".repeat(64),
            }),
        )
        .await
        .expect_problem(StatusCode::BAD_REQUEST, "invalid_request");
}

#[tokio::test]
async fn a_cross_folder_move_places_the_entry_and_updates_both_orders() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    harness
        .create_bookmark(&dev, "Existing", "https://existing.example")
        .await;
    let existing = harness.child_ids(&dev).await[0].clone();

    let revision = find_node(&harness.tree().await, &one).expect("the entry")["revision"]
        .as_str()
        .expect("a revision")
        .to_owned();

    let response = harness
        .move_entry(&one, &revision, &root, &dev, Some(0))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());

    assert_eq!(
        harness.child_ids(&dev).await,
        refs(&[&one, &existing]),
        "placed at the index the request asked for"
    );
    assert_eq!(
        harness.child_ids(&root).await,
        refs(&[&two, &dev, &ops]),
        "and taken out of the folder it left"
    );
}

#[tokio::test]
async fn a_cross_folder_move_appends_when_no_index_is_given() {
    let harness = Harness::new();
    let (root, [one, _two, dev, _ops]) = populated(&harness).await;
    harness
        .create_bookmark(&dev, "Existing", "https://existing.example")
        .await;
    let existing = harness.child_ids(&dev).await[0].clone();
    let revision = find_node(&harness.tree().await, &one).expect("the entry")["revision"]
        .as_str()
        .expect("a revision")
        .to_owned();

    harness.move_entry(&one, &revision, &root, &dev, None).await;
    assert_eq!(harness.child_ids(&dev).await, refs(&[&existing, &one]));
}

#[tokio::test]
async fn a_folder_moves_across_folders_and_keeps_its_own_order() {
    let harness = Harness::new();
    let (root, [_one, _two, dev, ops]) = populated(&harness).await;
    let first = harness
        .create_bookmark(&dev, "First", "https://1.example")
        .await;
    let second = harness
        .create_bookmark(&dev, "Second", "https://2.example")
        .await;
    let first_id = first["id"].as_str().expect("an id").to_owned();
    let second_id = second["id"].as_str().expect("an id").to_owned();
    harness
        .set_order(&dev, &[(&second_id, "bookmark"), (&first_id, "bookmark")])
        .await;

    let revision = find_node(&harness.tree().await, &dev).expect("the folder")["revision"]
        .as_str()
        .expect("a revision")
        .to_owned();
    let response = harness
        .move_entry(&dev, &revision, &root, &ops, Some(0))
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());

    assert_eq!(harness.child_ids(&ops).await, refs(&[&dev]));
    assert_eq!(
        harness.child_ids(&dev).await,
        refs(&[&second_id, &first_id]),
        "a folder carries its own order with it"
    );
}

#[tokio::test]
async fn a_move_with_a_stale_source_or_destination_order_revision_is_refused() {
    let wrong = "0".repeat(64);
    for (label, source, destination) in [
        ("stale source", Some(wrong.as_str()), None),
        ("stale destination", None, Some(wrong.as_str())),
    ] {
        let harness = Harness::new();
        let (root, [one, _two, dev, _ops]) = populated(&harness).await;
        let revision = find_node(&harness.tree().await, &one).expect("the entry")["revision"]
            .as_str()
            .expect("a revision")
            .to_owned();
        let before = vault_files(harness.root());

        let live_source = harness.state_revision(&root).await.expect("a revision");
        let live_destination = harness.state_revision(&dev).await.expect("a revision");
        let body = json!({
            "revision": revision,
            "parentId": dev,
            "sourceStateRevision": source.unwrap_or(&live_source),
            "destinationStateRevision": destination.unwrap_or(&live_destination),
        });

        harness
            .post(&format!("/api/v1/bookmarks/{one}/move"), &body)
            .await
            .expect_problem(StatusCode::CONFLICT, "stale_state_revision");
        assert_eq!(
            vault_files(harness.root()),
            before,
            "{label}: a refused move leaves the vault exactly as it was"
        );
    }
}

#[tokio::test]
async fn a_move_into_a_descendant_is_still_refused_with_an_index() {
    let harness = Harness::new();
    let (root, [_one, _two, dev, _ops]) = populated(&harness).await;
    let nested = harness.create_folder(&dev, "Nested").await;
    let nested_id = nested["id"].as_str().expect("an id").to_owned();
    let revision = find_node(&harness.tree().await, &dev).expect("the folder")["revision"]
        .as_str()
        .expect("a revision")
        .to_owned();

    harness
        .move_entry(&dev, &revision, &root, &nested_id, Some(0))
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "move_into_self");
    assert!(harness.root().join("Dev").join("Nested").is_dir());
}

// -- deleting --------------------------------------------------------------

#[tokio::test]
async fn a_delete_takes_the_entry_out_of_the_order_and_leaves_the_rest_alone() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    harness
        .set_order(
            &root,
            &[
                (&ops, "folder"),
                (&two, "bookmark"),
                (&dev, "folder"),
                (&one, "bookmark"),
            ],
        )
        .await;

    let revision = find_node(&harness.tree().await, &two).expect("the entry")["revision"]
        .as_str()
        .expect("a revision")
        .to_owned();
    let response = harness
        .delete_entry("bookmarks", &two, &revision, &root, "")
        .await;
    assert_eq!(
        response.status,
        StatusCode::NO_CONTENT,
        "{}",
        response.text()
    );

    assert_eq!(harness.child_ids(&root).await, refs(&[&ops, &dev, &one]));
    let written = fs::read_to_string(state_path(&harness, "")).expect("read");
    assert!(
        !written.contains(&two),
        "the reference is gone too: {written}"
    );
}

#[tokio::test]
async fn a_delete_without_the_parents_order_revision_is_refused() {
    let harness = Harness::new();
    let (_root, [one, ..]) = populated(&harness).await;
    let revision = find_node(&harness.tree().await, &one).expect("the entry")["revision"]
        .as_str()
        .expect("a revision")
        .to_owned();

    harness
        .delete(&format!("/api/v1/bookmarks/{one}?revision={revision}"))
        .await
        .expect_problem(StatusCode::CONFLICT, "stale_state_revision");
    assert!(harness.root().join(format!("One--{one}.md")).exists());
}

#[tokio::test]
async fn a_recursive_delete_accounts_for_every_nested_order_file() {
    let harness = Harness::new();
    let root = harness.root_id().await;
    let dev = harness.create_folder(&root, "Dev").await;
    let dev_id = dev["id"].as_str().expect("an id").to_owned();
    let revision = dev["revision"].as_str().expect("a revision").to_owned();
    let nested = harness.create_folder(&dev_id, "Nested").await;
    let nested_id = nested["id"].as_str().expect("an id").to_owned();
    harness
        .create_bookmark(&nested_id, "React", "https://react.dev")
        .await;

    // A nested order file is machine-managed bookkeeping the scan has read and
    // fingerprinted, so it is part of the subtree the daemon can describe and
    // does not block the delete — even when its contents are not usable, since
    // what matters is that the exact bytes are the ones that were checked.
    assert!(state_path(&harness, "Dev/Nested").is_file());
    write_external(
        harness.root(),
        &format!("Dev/Nested/{STATE_FILE_NAME}"),
        "{ not json",
    );
    harness.post("/api/v1/rescan", &json!({})).await;

    let response = harness
        .delete_entry("folders", &dev_id, &revision, &root, "&recursive=true")
        .await;
    assert_eq!(
        response.status,
        StatusCode::NO_CONTENT,
        "{}",
        response.text()
    );
    assert!(!harness.root().join("Dev").exists());
}

/// The one nested order file a recursive delete will not destroy is one it was
/// never able to read, because then it cannot know what it is throwing away.
#[cfg(unix)]
#[tokio::test]
async fn a_recursive_delete_refuses_a_nested_order_file_it_could_not_read() {
    let harness = Harness::new();
    let root = harness.root_id().await;
    let dev = harness.create_folder(&root, "Dev").await;
    let dev_id = dev["id"].as_str().expect("an id").to_owned();
    let revision = dev["revision"].as_str().expect("a revision").to_owned();
    harness.create_folder(&dev_id, "Nested").await;

    let path = harness.root().join("Dev/Nested").join(STATE_FILE_NAME);
    fs::remove_file(&path).expect("remove");
    write_external(harness.root(), "outside.json", "{}");
    std::os::unix::fs::symlink(harness.root().join("outside.json"), &path).expect("symlink");
    harness.post("/api/v1/rescan", &json!({})).await;

    harness
        .delete_entry("folders", &dev_id, &revision, &root, "&recursive=true")
        .await
        .expect_problem(StatusCode::CONFLICT, "subtree_has_unknown_files");
    assert!(harness.root().join("Dev").is_dir(), "nothing was destroyed");
}

#[tokio::test]
async fn a_folder_holding_only_its_own_bookkeeping_still_counts_as_empty() {
    let harness = Harness::new();
    let root = harness.root_id().await;
    let dev = harness.create_folder(&root, "Dev").await;
    let dev_id = dev["id"].as_str().expect("an id").to_owned();
    let revision = dev["revision"].as_str().expect("a revision").to_owned();

    assert!(state_path(&harness, "Dev").is_file());
    let response = harness
        .delete_entry("folders", &dev_id, &revision, &root, "")
        .await;
    assert_eq!(
        response.status,
        StatusCode::NO_CONTENT,
        "an order file is not something the folder contains: {}",
        response.text()
    );
}

// -- what the outside world does -------------------------------------------

#[tokio::test]
async fn an_external_edit_to_the_order_file_is_picked_up_once() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    let generation = harness.generation().await;

    let reversed = format!(
        "{{\n  \"version\": 1,\n  \"children\": [\n{}\n  ]\n}}\n",
        [&ops, &dev, &two, &one]
            .iter()
            .map(|id| format!(
                "    {{\n      \"id\": \"{id}\",\n      \"kind\": \"{}\",\n      \
                 \"addedAt\": \"2026-01-01T00:00:00Z\"\n    }}",
                if **id == ops || **id == dev {
                    "folder"
                } else {
                    "bookmark"
                }
            ))
            .collect::<Vec<_>>()
            .join(",\n")
    );
    write_external(harness.root(), STATE_FILE_NAME, &reversed);

    let rescan = harness.post("/api/v1/rescan", &json!({})).await.json();
    assert_eq!(rescan["changed"], true, "an order change is a change");
    assert_eq!(
        harness.child_ids(&root).await,
        refs(&[&ops, &dev, &two, &one])
    );
    assert_eq!(
        harness.generation().await,
        generation + 1,
        "and advances the generation exactly once"
    );

    let again = harness.post("/api/v1/rescan", &json!({})).await.json();
    assert_eq!(again["changed"], false, "with no echo afterwards");
    assert_eq!(harness.generation().await, generation + 1);
}

#[tokio::test]
async fn an_externally_added_bookmark_is_appended_and_adopted_by_the_next_change() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;

    write_external(
        harness.root(),
        "Outside--88888888.md",
        "---\nbbb_id: 88888888\nbbb_url: https://outside.example\nbbb_title: Outside\n\
         bbb_created: 2020-01-01T00:00:00Z\nbbb_updated: 2020-01-01T00:00:00Z\n---\n",
    );
    harness.post("/api/v1/rescan", &json!({})).await;

    assert_eq!(
        harness.child_ids(&root).await,
        refs(&[&one, &two, &dev, &ops, &"88888888".to_owned()]),
        "an entry the order does not know about appears at the end, however old \
         its timestamp is"
    );

    // The next authorised change adopts it where it already sits.
    harness
        .create_bookmark(&root, "Later", "https://later.example")
        .await;
    let written = fs::read_to_string(state_path(&harness, "")).expect("read");
    assert!(written.contains("88888888"), "{written}");
    assert_eq!(harness.child_ids(&root).await.len(), 6);
    assert_eq!(harness.child_ids(&root).await[4], "88888888");
}

#[tokio::test]
async fn a_reference_to_something_that_is_not_there_is_kept_across_a_reorder() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;

    // The bookmark leaves the vault the way a sync client would take it: the
    // file goes, the reference stays.
    fs::remove_file(harness.root().join(format!("Two--{two}.md"))).expect("remove");
    harness.post("/api/v1/rescan", &json!({})).await;
    assert_eq!(harness.child_ids(&root).await, refs(&[&one, &dev, &ops]));

    harness
        .set_order(
            &root,
            &[(&ops, "folder"), (&dev, "folder"), (&one, "bookmark")],
        )
        .await;

    let written = fs::read_to_string(state_path(&harness, "")).expect("read");
    assert!(
        written.contains(&two),
        "a reference to a file that may still come back must not be pruned: {written}"
    );

    // And when it does come back, it lands where it was.
    write_external(
        harness.root(),
        &format!("Two--{two}.md"),
        "---\nbbb_id: 00000000\n---\n",
    );
    let restored = format!(
        "---\nbbb_id: {two}\nbbb_url: https://two.example\nbbb_title: Two\n\
         bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\n"
    );
    write_external(harness.root(), &format!("Two--{two}.md"), &restored);
    harness.post("/api/v1/rescan", &json!({})).await;
    assert!(
        harness.child_ids(&root).await.contains(&two),
        "the returning entry is placed by the reference that was kept"
    );
}

#[tokio::test]
async fn a_folder_whose_order_file_cannot_be_rewritten_refuses_positional_changes_only() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;

    // A key from a version this build does not know. The order is still
    // honoured; rewriting the file would throw the key away.
    write_external(
        harness.root(),
        STATE_FILE_NAME,
        &format!(
            "{{\"version\":1,\"pinned\":[\"{one}\"],\"children\":[\
               {{\"id\":\"{ops}\",\"kind\":\"folder\",\"addedAt\":\"2026-01-01T00:00:00Z\"}},\
               {{\"id\":\"{one}\",\"kind\":\"bookmark\",\"addedAt\":\"2026-01-01T00:00:00Z\"}}]}}"
        ),
    );
    harness.post("/api/v1/rescan", &json!({})).await;

    let tree = harness.tree().await;
    let node = find_node(&tree, &root).expect("the root");
    assert_eq!(node["orderReadOnly"], true, "{node}");
    assert_eq!(
        harness.child_ids(&root).await,
        refs(&[&ops, &one, &dev, &two]),
        "the order it can read is still used, and the rest follow it"
    );

    let before = vault_files(harness.root());
    harness
        .set_order(
            &root,
            &[
                (&one, "bookmark"),
                (&two, "bookmark"),
                (&dev, "folder"),
                (&ops, "folder"),
            ],
        )
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "state_read_only");

    let state = harness.state_revision(&root).await.expect("a revision");
    harness
        .post(
            "/api/v1/bookmarks",
            &json!({
                "parentId": root, "title": "New", "url": "https://new.example",
                "index": 0, "parentStateRevision": state,
            }),
        )
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "state_read_only");
    assert_eq!(
        vault_files(harness.root()),
        before,
        "neither refusal touched a byte"
    );

    // But an ordinary create still works. It simply cannot be placed: the entry
    // joins the group the order file says nothing about.
    let frozen_before = fs::read_to_string(state_path(&harness, "")).expect("read");
    let created = harness
        .create_bookmark(&root, "New", "https://new.example")
        .await;
    let new = created["id"].as_str().expect("an id").to_owned();

    assert_eq!(
        fs::read_to_string(state_path(&harness, "")).expect("read"),
        frozen_before,
        "the frozen file is never written to, not even to record a new child"
    );
    let children = harness.child_ids(&root).await;
    assert!(children.contains(&new), "{children:?}");
    assert_eq!(
        &children[..2],
        refs(&[&ops, &one]),
        "and the order it could read is still respected"
    );
}

#[tokio::test]
async fn a_malformed_order_file_refuses_a_reorder_and_is_never_repaired() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    write_external(harness.root(), STATE_FILE_NAME, "{ not json");
    harness.post("/api/v1/rescan", &json!({})).await;

    harness
        .set_order(
            &root,
            &[
                (&ops, "folder"),
                (&one, "bookmark"),
                (&two, "bookmark"),
                (&dev, "folder"),
            ],
        )
        .await
        .expect_problem(StatusCode::UNPROCESSABLE_ENTITY, "state_read_only");

    assert_eq!(
        fs::read_to_string(state_path(&harness, "")).expect("read"),
        "{ not json",
        "the daemon never quietly replaces a file it cannot read"
    );

    let warnings = harness.get("/api/v1/health").await.json();
    let codes: Vec<String> = warnings["warnings"]
        .as_array()
        .expect("warnings")
        .iter()
        .map(|warning| warning["code"].as_str().unwrap_or_default().to_owned())
        .collect();
    assert!(
        codes.iter().any(|code| code == "state_malformed"),
        "{codes:?}"
    );
}

#[tokio::test]
async fn losing_the_order_file_falls_back_to_migration_order_and_is_repaired_by_the_next_change() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    harness
        .set_order(
            &root,
            &[
                (&ops, "folder"),
                (&two, "bookmark"),
                (&dev, "folder"),
                (&one, "bookmark"),
            ],
        )
        .await;

    // A sync client that does not carry dot-files, or a user tidying up.
    fs::remove_file(state_path(&harness, "")).expect("remove");
    harness.post("/api/v1/rescan", &json!({})).await;

    // The migration order: folders first, then bookmarks, each group by the
    // creation timestamp they carry and then by identity. These four were made
    // within the same second, so identity decides throughout.
    let mut folders = [dev.clone(), ops.clone()];
    folders.sort();
    let mut bookmarks = [one.clone(), two.clone()];
    bookmarks.sort();
    let migration: Vec<String> = folders.iter().chain(bookmarks.iter()).cloned().collect();
    assert_eq!(
        harness.child_ids(&root).await,
        migration,
        "the arrangement is lost, and what is left is deterministic"
    );
    assert_eq!(
        harness.state_revision(&root).await,
        None,
        "a client is told there is no order file rather than sent a stale revision"
    );

    // The next change writes a fresh one, pinning what is being displayed.
    let created = harness
        .create_bookmark(&root, "New", "https://new.example")
        .await;
    let new = created["id"].as_str().expect("an id").to_owned();
    assert!(state_path(&harness, "").is_file());
    let mut expected = migration;
    expected.push(new);
    assert_eq!(harness.child_ids(&root).await, expected);
}

#[tokio::test]
async fn a_cloud_client_that_delivers_half_a_change_is_absorbed() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;

    // The order file arrives from another machine naming a bookmark that has
    // not been delivered yet, and one of the local entries is not in it at all.
    let order = format!(
        "{{\n  \"version\": 1,\n  \"children\": [\n{}\n  ]\n}}\n",
        [
            ("77777777", "bookmark"),
            (ops.as_str(), "folder"),
            (one.as_str(), "bookmark"),
        ]
        .iter()
        .map(|(id, kind)| format!(
            "    {{\n      \"id\": \"{id}\",\n      \"kind\": \"{kind}\",\n      \
             \"addedAt\": \"2026-01-01T00:00:00Z\"\n    }}"
        ))
        .collect::<Vec<_>>()
        .join(",\n")
    );
    write_external(harness.root(), STATE_FILE_NAME, &order);
    harness.post("/api/v1/rescan", &json!({})).await;

    assert_eq!(
        harness.child_ids(&root).await,
        refs(&[&ops, &one, &dev, &two]),
        "what arrived is honoured, what has not arrived takes no space, and \
         what the file never mentioned follows"
    );

    // Reordering the ones that are here keeps the reference to the one that is
    // not, so it lands in the right place when it finally shows up.
    let response = harness
        .set_order(
            &root,
            &[
                (&one, "bookmark"),
                (&ops, "folder"),
                (&two, "bookmark"),
                (&dev, "folder"),
            ],
        )
        .await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());
    let written = fs::read_to_string(state_path(&harness, "")).expect("read");
    assert!(written.contains("77777777"), "{written}");

    write_external(
        harness.root(),
        "Late--77777777.md",
        "---\nbbb_id: 77777777\nbbb_url: https://late.example\nbbb_title: Late\n\
         bbb_created: 2026-01-01T00:00:00Z\nbbb_updated: 2026-01-01T00:00:00Z\n---\n",
    );
    harness.post("/api/v1/rescan", &json!({})).await;
    let children = harness.child_ids(&root).await;
    assert_eq!(
        children[0], "77777777",
        "the kept reference put it back where it belonged: {children:?}"
    );
}

#[tokio::test]
async fn a_directory_with_no_identity_cannot_be_ordered_and_never_blocks_a_reorder() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    // A folder the user made in a file manager: no `.bbb-folder.md`, so nothing
    // can record where it goes.
    write_external(harness.root(), "Loose/note.txt", "mine");
    harness.post("/api/v1/rescan", &json!({})).await;

    let response = harness
        .set_order(
            &root,
            &[
                (&ops, "folder"),
                (&dev, "folder"),
                (&two, "bookmark"),
                (&one, "bookmark"),
            ],
        )
        .await;
    assert_eq!(
        response.status,
        StatusCode::OK,
        "an unaddressable directory must not make the folder unorderable: {}",
        response.text()
    );

    let children = harness.child_ids(&root).await;
    assert_eq!(children[..4], refs(&[&ops, &dev, &two, &one])[..]);
    assert_eq!(
        children[4], "!Loose",
        "and it sits at the end, addressed by its path: {children:?}"
    );
}

#[tokio::test]
async fn the_order_file_a_reorder_writes_is_canonical() {
    let harness = Harness::new();
    let (root, [one, two, dev, ops]) = populated(&harness).await;
    harness
        .set_order(
            &root,
            &[
                (&ops, "folder"),
                (&one, "bookmark"),
                (&dev, "folder"),
                (&two, "bookmark"),
            ],
        )
        .await;

    let written = fs::read_to_string(state_path(&harness, "")).expect("read");
    assert!(written.ends_with("}\n"), "a final newline: {written:?}");
    assert!(written.starts_with("{\n  \"version\": 1,\n"), "{written}");
    assert!(
        written.contains("      \"kind\": \"folder\",\n"),
        "two-space indentation, one key per line: {written}"
    );
    let parsed: serde_json::Value = serde_json::from_str(&written).expect("valid JSON");
    assert_eq!(parsed["children"].as_array().expect("children").len(), 4);
    assert_eq!(parsed["children"][0]["id"], ops);
    assert!(
        parsed["children"][0]["addedAt"].as_str().is_some(),
        "every child records when it joined this folder: {written}"
    );
}
