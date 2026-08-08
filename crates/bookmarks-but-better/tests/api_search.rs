//! Bookmark search contract and edge cases.

mod support;

use axum::http::StatusCode;
use support::Harness;

#[tokio::test]
async fn search_is_case_insensitive_ranked_and_bookmark_only() {
    let harness = Harness::new();
    let root = harness.root_id().await;
    harness
        .create_bookmark(&root, "Rust", "https://www.rust-lang.org")
        .await;
    harness
        .create_bookmark(&root, "Rust Book", "https://doc.rust-lang.org/book")
        .await;
    harness
        .create_bookmark(&root, "Language", "https://example.com/RUST")
        .await;
    harness.create_folder(&root, "Rust folder").await;

    let response = harness.get("/api/v1/search?q=rUsT&limit=10").await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());
    let body = response.json();
    let results = body["results"].as_array().expect("results array");

    assert_eq!(results.len(), 3, "folders are never search results: {body}");
    assert_eq!(results[0]["title"], "Rust");
    assert_eq!(results[1]["title"], "Rust Book");
    assert_eq!(results[2]["title"], "Language");
    assert!(results.iter().all(|item| item["url"].is_string()));
}

#[tokio::test]
async fn empty_search_is_safe_and_returns_nothing() {
    let harness = Harness::new();
    let root = harness.root_id().await;
    harness
        .create_bookmark(&root, "Example", "https://example.com")
        .await;

    for path in ["/api/v1/search", "/api/v1/search?q=%20%20%20"] {
        let response = harness.get(path).await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text());
        assert_eq!(response.json()["results"], serde_json::json!([]));
    }
}

#[tokio::test]
async fn search_enforces_limit_and_query_bounds() {
    let harness = Harness::new();
    let root = harness.root_id().await;
    for index in 0..4 {
        harness
            .create_bookmark(
                &root,
                &format!("Example {index}"),
                &format!("https://example.com/{index}"),
            )
            .await;
    }

    let response = harness.get("/api/v1/search?q=example&limit=2").await;
    assert_eq!(response.status, StatusCode::OK, "{}", response.text());
    assert_eq!(response.json()["results"].as_array().map(Vec::len), Some(2));

    for path in [
        "/api/v1/search?q=example&limit=0",
        "/api/v1/search?q=example&limit=21",
    ] {
        harness
            .get(path)
            .await
            .expect_problem(StatusCode::BAD_REQUEST, "invalid_request");
    }

    let too_long = "x".repeat(257);
    harness
        .get(&format!("/api/v1/search?q={too_long}"))
        .await
        .expect_problem(StatusCode::BAD_REQUEST, "invalid_request");
}
