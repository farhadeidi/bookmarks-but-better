//! Serving the built web UI, without following a single link.
//!
//! `tower_http::services::ServeDir` opens files through `tokio::fs`, which
//! follows symbolic links and offers no way to stop it. That is fine for a
//! static host whose directory nobody else can write to, and not fine for a
//! daemon pointed at a path the user typed: a link inside `--ui-dir` would let
//! the daemon read any file the user can read and serve it over HTTP.
//!
//! So the UI directory is opened once as a sandboxed handle and every request
//! path is resolved against it component by component with no-follow. A link
//! anywhere in the path is a 404, whether or not it escapes the directory —
//! rejecting them all is a rule that can be stated in one line and verified by
//! reading it, which "rejects the ones that escape" is not.
//!
//! The single-page fallback is unchanged: a path with no file behind it serves
//! `index.html`, because the JavaScript router owns those routes. That fallback
//! is exactly why the API is mounted first and carries its own 404 — otherwise
//! a mistyped API path would return an HTML page with status 200.

use std::path::Path;
use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::State;
use axum::http::{HeaderValue, StatusCode, Uri, header};
use axum::response::{IntoResponse, Response};
use axum::routing::any;
use cap_fs_ext::DirExt as _;
use cap_std::fs::Dir;

use crate::api;
use crate::fsx;

/// The document served for every route the JavaScript router owns.
const INDEX: &str = "index.html";

/// A directory of built assets, opened once.
#[derive(Debug, Clone)]
struct UiState {
    directory: Arc<Dir>,
}

/// Builds the static-file service for `directory`.
///
/// Returns `None` when the directory has no `index.html`: a directory without
/// one cannot serve a single-page application, and quietly serving something
/// else would be worse than saying so.
pub(crate) fn service(directory: &Path) -> Option<Router> {
    let handle = fsx::open_root(directory).ok()?;
    if !is_regular_file(&handle, INDEX) {
        return None;
    }

    let state = UiState {
        directory: Arc::new(handle),
    };
    Some(Router::new().fallback(any(serve)).with_state(state))
}

async fn serve(State(state): State<UiState>, uri: Uri) -> Response {
    let Some(relative) = request_path(uri.path()) else {
        // A traversal attempt is not a missing page; it is a request that had
        // no legitimate reading, so it gets the API's own refusal shape.
        return api::unknown_route().await.into_response();
    };

    let directory = Arc::clone(&state.directory);
    let outcome = tokio::task::spawn_blocking(move || load(&directory, &relative)).await;

    match outcome {
        Ok(Some(asset)) => asset.into_response(),
        // Nothing there, or something there that is not a plain file: fall back
        // to the SPA index so a deep link survives a refresh.
        Ok(None) => {
            let directory = Arc::clone(&state.directory);
            match tokio::task::spawn_blocking(move || load(&directory, INDEX)).await {
                Ok(Some(index)) => index.into_response(),
                _ => api::unknown_route().await.into_response(),
            }
        }
        Err(_) => api::unknown_route().await.into_response(),
    }
}

/// One asset, read into memory with the type it should be served as.
struct Asset {
    bytes: Vec<u8>,
    content_type: &'static str,
}

impl IntoResponse for Asset {
    fn into_response(self) -> Response {
        (
            StatusCode::OK,
            [(
                header::CONTENT_TYPE,
                HeaderValue::from_static(self.content_type),
            )],
            Body::from(self.bytes),
        )
            .into_response()
    }
}

/// Reads `relative` from `directory`, refusing to traverse any link.
///
/// Returns `None` for anything that is not a plain file reached without
/// following a link, which the caller turns into the SPA fallback.
fn load(directory: &Dir, relative: &str) -> Option<Asset> {
    let (parents, name) = split(relative)?;

    let mut current = directory.try_clone().ok()?;
    for component in parents {
        // `open_dir_nofollow` fails on a symlinked component, so a link at any
        // depth ends the resolution here rather than being walked through.
        current = current.open_dir_nofollow(component).ok()?;
    }

    if !is_regular_file(&current, name) {
        return None;
    }
    let bytes = fsx::read(&current, name).ok()?;

    Some(Asset {
        bytes,
        content_type: content_type(name),
    })
}

/// Whether `name` in `dir` is a plain file, judged without following links.
fn is_regular_file(dir: &Dir, name: &str) -> bool {
    dir.symlink_metadata(name)
        .is_ok_and(|metadata| metadata.is_file())
}

/// Turns a request path into a vault-relative name, or `None` if it is unsafe.
///
/// `/` maps to the index. Empty, `.` and `..` components are refused outright
/// rather than normalised, because normalising a traversal is how traversals
/// get through.
fn request_path(path: &str) -> Option<String> {
    // Exactly one leading slash is removed. Trimming every leading slash would
    // quietly turn `//x` into `x`, which is the kind of normalisation that
    // makes a later "no empty components" check meaningless.
    let trimmed = path.strip_prefix('/').unwrap_or(path);
    if trimmed.is_empty() {
        return Some(INDEX.to_owned());
    }
    if trimmed.ends_with('/') {
        // A directory URL means its index document, as every static host does.
        return request_path(&format!("{trimmed}{INDEX}"));
    }
    for component in trimmed.split('/') {
        if component.is_empty() || component == "." || component == ".." {
            return None;
        }
    }
    Some(trimmed.to_owned())
}

fn split(relative: &str) -> Option<(Vec<&str>, &str)> {
    let mut components: Vec<&str> = relative.split('/').collect();
    let name = components.pop()?;
    if name.is_empty() {
        return None;
    }
    Some((components, name))
}

/// The MIME type for a file name.
///
/// `mime_guess` is the table `tower_http` used, so the types served are the
/// ones the UI was already receiving.
fn content_type(name: &str) -> &'static str {
    // `first_raw` yields a `&'static str` from the crate's static table, so no
    // allocation is needed for the common case.
    mime_guess::from_path(name)
        .first_raw()
        .unwrap_or("application/octet-stream")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_paths_are_normalised_or_refused() {
        assert_eq!(request_path("/").as_deref(), Some("index.html"));
        assert_eq!(
            request_path("/assets/app.js").as_deref(),
            Some("assets/app.js")
        );
        assert_eq!(
            request_path("/assets/").as_deref(),
            Some("assets/index.html")
        );

        for path in ["/../secret", "/a/../../b", "/./x", "//x", "/a//b"] {
            assert!(request_path(path).is_none(), "{path} must be refused");
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_asset_is_not_served() {
        let outer = tempfile::tempdir().expect("temp dir");
        let ui = outer.path().join("dist");
        std::fs::create_dir(&ui).expect("create ui");
        std::fs::write(ui.join(INDEX), b"<!doctype html>").expect("index");
        let secret = outer.path().join("secret.txt");
        std::fs::write(&secret, b"top secret").expect("secret");
        std::os::unix::fs::symlink(&secret, ui.join("leak.txt")).expect("symlink");

        let handle = fsx::open_root(&ui).expect("open ui");
        assert!(
            load(&handle, "leak.txt").is_none(),
            "a symlinked file must never be served"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_directory_component_is_not_traversed() {
        let outer = tempfile::tempdir().expect("temp dir");
        let ui = outer.path().join("dist");
        std::fs::create_dir(&ui).expect("create ui");
        std::fs::write(ui.join(INDEX), b"<!doctype html>").expect("index");
        let elsewhere = outer.path().join("elsewhere");
        std::fs::create_dir(&elsewhere).expect("create elsewhere");
        std::fs::write(elsewhere.join("secret.txt"), b"top secret").expect("secret");
        std::os::unix::fs::symlink(&elsewhere, ui.join("assets")).expect("symlink");

        let handle = fsx::open_root(&ui).expect("open ui");
        assert!(
            load(&handle, "assets/secret.txt").is_none(),
            "a symlinked directory must never be traversed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_that_stays_inside_the_ui_directory_is_also_refused() {
        let outer = tempfile::tempdir().expect("temp dir");
        let ui = outer.path().join("dist");
        std::fs::create_dir(&ui).expect("create ui");
        std::fs::write(ui.join(INDEX), b"<!doctype html>").expect("index");
        std::fs::write(ui.join("real.js"), b"console.log(1)").expect("real");
        std::os::unix::fs::symlink(ui.join("real.js"), ui.join("alias.js")).expect("symlink");

        let handle = fsx::open_root(&ui).expect("open ui");
        assert!(
            load(&handle, "real.js").is_some(),
            "the real file is served"
        );
        assert!(
            load(&handle, "alias.js").is_none(),
            "links are refused even when they point inside the directory"
        );
    }

    #[test]
    fn content_types_match_what_the_bundle_needs() {
        assert!(content_type("index.html").starts_with("text/html"));
        assert!(content_type("app.js").contains("javascript"));
        assert!(content_type("app.css").starts_with("text/css"));
        assert_eq!(content_type("logo.svg"), "image/svg+xml");
        assert_eq!(content_type("mystery.zzz"), "application/octet-stream");
    }
}
