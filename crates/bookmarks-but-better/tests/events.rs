//! Change propagation: generations, reconciliation and the SSE stream.

mod support;

use std::time::Duration;

use axum::http::StatusCode;
use serde_json::json;
use support::{Harness, TEST_HOST, find_node, vault_files, write_external};
use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::{TcpListener, TcpStream};

/// Watch tuning that reacts fast enough for a test to wait on.
fn quick_watch() -> bookmarks_but_better::watch::WatchOptions {
    bookmarks_but_better::watch::WatchOptions {
        debounce: Duration::from_millis(30),
        fallback_interval: Duration::from_millis(150),
    }
}

/// A bookmark an external editor might drop into the vault.
fn external_bookmark(id: &str, title: &str) -> String {
    format!(
        "---\nbookmarks_but_better_id: {id}\nbookmarks_but_better_url: https://example.com\nbookmarks_but_better_title: {title}\n\
         bookmarks_but_better_created: 2026-01-01T00:00:00Z\nbookmarks_but_better_updated: 2026-01-01T00:00:00Z\n---\n"
    )
}

#[tokio::test]
async fn a_rescan_that_finds_nothing_new_does_not_advance_the_generation() {
    let harness = Harness::new();
    let before = harness.generation().await;

    for _ in 0..3 {
        let response = harness.post("/api/v1/rescan", &json!({})).await;
        assert_eq!(response.status, StatusCode::OK, "{}", response.text());
        assert_eq!(
            response.json()["changed"],
            false,
            "nothing changed, so nothing is published"
        );
    }

    assert_eq!(
        harness.generation().await,
        before,
        "the generation tracks content, not scans"
    );
}

#[tokio::test]
async fn an_external_edit_advances_the_generation_on_the_next_rescan() {
    let harness = Harness::new();
    let before = harness.generation().await;

    write_external(
        harness.root(),
        "Notes--11112222.md",
        &external_bookmark("11112222", "Notes"),
    );

    let response = harness.post("/api/v1/rescan", &json!({})).await;
    assert_eq!(response.json()["changed"], true, "{}", response.text());
    let after = response.json()["generation"]
        .as_u64()
        .expect("a generation");
    assert!(after > before, "{after} must be newer than {before}");
    assert_eq!(harness.generation().await, after);

    let tree = harness.tree().await;
    assert_eq!(
        find_node(&tree, "11112222").expect("the external bookmark is visible")["title"],
        "Notes"
    );
}

#[tokio::test]
async fn a_daemon_write_advances_the_generation_exactly_once() {
    let harness = Harness::with_options(|_| {});
    let watcher = harness.daemon().watch(quick_watch());
    let mut changes = harness.daemon().vault().subscribe();
    let root_id = harness.root_id().await;

    let before = harness.generation().await;
    harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;

    let generation = tokio::time::timeout(Duration::from_secs(5), changes.recv())
        .await
        .expect("a change is published")
        .expect("the channel stays open");
    assert_eq!(generation, before + 1);

    // The watcher will notice the daemon's own write and rescan. Because the
    // tree it finds is the tree that was already published, that rescan must
    // produce no second event — this is the self-write coalescing.
    let phantom = tokio::time::timeout(Duration::from_millis(600), changes.recv()).await;
    assert!(
        phantom.is_err(),
        "the daemon's own write must not echo back as a change: {phantom:?}"
    );
    assert_eq!(harness.generation().await, generation);

    watcher.shutdown().await;
}

#[tokio::test]
async fn the_watcher_picks_up_an_external_edit_without_a_rescan_request() {
    let harness = Harness::new();
    let watcher = harness.daemon().watch(quick_watch());
    let mut changes = harness.daemon().vault().subscribe();
    let before = harness.generation().await;

    write_external(
        harness.root(),
        "Notes--33334444.md",
        &external_bookmark("33334444", "Notes"),
    );

    let generation = tokio::time::timeout(Duration::from_secs(10), changes.recv())
        .await
        .expect("the vault change is noticed on its own")
        .expect("the channel stays open");
    assert!(generation > before);

    let tree = harness.tree().await;
    assert!(
        find_node(&tree, "33334444").is_some(),
        "the new bookmark is in the tree without anyone asking for a rescan"
    );

    watcher.shutdown().await;
}

#[tokio::test]
async fn reconciling_an_untouched_vault_writes_nothing() {
    let harness = Harness::new();
    let root_id = harness.root_id().await;
    harness
        .create_bookmark(&root_id, "React", "https://react.dev")
        .await;

    let before = vault_files(harness.root());
    let watcher = harness.daemon().watch(quick_watch());
    // Long enough for several periodic reconciles at this interval.
    tokio::time::sleep(Duration::from_millis(700)).await;
    watcher.shutdown().await;

    assert_eq!(
        vault_files(harness.root()),
        before,
        "reconciliation reads the vault; it never writes to it"
    );
}

#[tokio::test]
async fn the_event_stream_opens_with_the_current_generation_and_follows_changes() {
    let harness = Harness::new();
    let watcher = harness.daemon().watch(quick_watch());

    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
    let address = listener.local_addr().expect("local address");
    let router = harness.daemon().router();
    let server = tokio::spawn(async move {
        let _ = axum::serve(listener, router).await;
    });

    let mut stream = TcpStream::connect(address).await.expect("connect");
    stream
        .write_all(
            format!(
                "GET /api/v1/events HTTP/1.1\r\nHost: {TEST_HOST}\r\n\
                 Accept: text/event-stream\r\n\r\n"
            )
            .as_bytes(),
        )
        .await
        .expect("send request");

    let mut buffer = String::new();
    let mut seen = 0usize;

    // The stream opens by stating where the client currently is, so a client
    // that connects late still knows whether it is behind.
    let first = next_generation(&mut stream, &mut buffer, &mut seen).await;
    assert_eq!(first, harness.generation().await);

    // An edit made outside the daemon reaches the open stream.
    write_external(
        harness.root(),
        "Notes--55556666.md",
        &external_bookmark("55556666", "Notes"),
    );
    let second = next_generation(&mut stream, &mut buffer, &mut seen).await;
    assert!(
        second > first,
        "the change event carries a newer generation: {second} vs {first}"
    );
    assert_eq!(second, harness.generation().await);

    assert!(
        buffer.contains("text/event-stream"),
        "the response is an event stream: {buffer}"
    );
    assert!(
        buffer.contains("event: changed"),
        "events are named `changed`: {buffer}"
    );

    drop(stream);
    server.abort();
    watcher.shutdown().await;
}

/// Reads until one more `generation` value than `seen` has arrived.
///
/// The raw socket carries HTTP/1.1 chunk framing around the SSE payload, so the
/// values are picked out of the accumulated text rather than parsed as frames.
async fn next_generation(stream: &mut TcpStream, buffer: &mut String, seen: &mut usize) -> u64 {
    let deadline = Duration::from_secs(10);
    let read = async {
        loop {
            if let Some(value) = generations(buffer).get(*seen).copied() {
                *seen += 1;
                return value;
            }
            let mut chunk = [0u8; 4096];
            let read = stream.read(&mut chunk).await.expect("read from the stream");
            assert!(read > 0, "the stream closed early: {buffer}");
            buffer.push_str(&String::from_utf8_lossy(&chunk[..read]));
        }
    };
    tokio::time::timeout(deadline, read)
        .await
        .unwrap_or_else(|_| panic!("no event arrived within {deadline:?}: {buffer}"))
}

/// Every `{"generation":N}` value in the text so far, in order.
fn generations(text: &str) -> Vec<u64> {
    text.match_indices(r#""generation":"#)
        .filter_map(|(index, marker)| {
            text[index + marker.len()..]
                .chars()
                .take_while(char::is_ascii_digit)
                .collect::<String>()
                .parse()
                .ok()
        })
        .collect()
}
