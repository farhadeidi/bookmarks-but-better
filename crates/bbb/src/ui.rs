//! Serving the built web UI.
//!
//! The UI is a single-page application, so a request for `/settings` is not a
//! request for a file — it is a route the JavaScript router will handle once the
//! page loads. Anything that does not match a real file therefore falls back to
//! `index.html`.
//!
//! That fallback is exactly why the API is mounted first and carries its own
//! 404: without it, a typo in an API path would return an HTML page with status
//! 200, and a client would parse a `<!doctype html>` as JSON.

use std::path::Path;

use axum::Router;
use tower_http::services::{ServeDir, ServeFile};

/// Builds the fallback service that serves `directory` with an SPA index.
///
/// Returns `None` when the directory has no `index.html`, because a directory
/// without one cannot serve a single-page application and silently serving
/// directory listings instead would be worse than saying so.
pub(crate) fn service(directory: &Path) -> Option<Router> {
    let index = directory.join("index.html");
    if !index.is_file() {
        return None;
    }

    let serve_dir = ServeDir::new(directory)
        // A directory URL means its `index.html`, as every static host does.
        .append_index_html_on_directories(true)
        // Anything with no file behind it is an SPA route.
        .fallback(ServeFile::new(index));

    Some(Router::new().fallback_service(serve_dir))
}
