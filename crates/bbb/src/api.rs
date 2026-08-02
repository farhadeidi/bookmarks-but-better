//! The versioned HTTP surface.
//!
//! Everything lives under `/api/v1`. The version is in the path rather than in
//! a header so that a served UI bundle and the daemon it talks to can be
//! upgraded independently and still fail loudly rather than subtly.
//!
//! Handlers are thin: they parse addresses, hand the work to [`Vault`], and
//! render the result. Every decision about *whether* something is allowed lives
//! in the vault module, so there is one place to read the rules.
//!
//! Vault work is filesystem work, so each call is moved onto a blocking thread
//! rather than run on the async runtime, where a slow disk would stall every
//! other connection.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::routing::{delete, get, patch, post, put};
use tokio_stream::wrappers::BroadcastStream;
use tokio_stream::{Stream, StreamExt as _};

use bbb_vault_core::{ChildKind, Id};

use crate::dto::{
    self, BookmarkDto, CreateBookmarkRequest, CreateFolderRequest, DeleteQuery, HealthResponse,
    MoveRequest, OrderChild, OrderRequest, Placement, RescanResponse, SearchQuery, SearchResponse,
    TreeResponse, UpdateRequest,
};
use crate::entry::EntryRef;
use crate::extract::{ApiJson, ApiQuery};
use crate::problem::{Problem, ProblemCode};
use crate::vault::{MovePlan, Vault};

/// How often an idle event stream is nudged so proxies and clients keep it open.
const SSE_KEEP_ALIVE: Duration = Duration::from_secs(15);
const MAX_SEARCH_QUERY_CHARS: usize = 256;
const MAX_SEARCH_LIMIT: usize = 20;

/// What every handler shares.
#[derive(Debug, Clone)]
pub struct ApiState {
    /// The vault being served.
    pub vault: Arc<Vault>,
}

/// Builds the `/api/v1` routes.
///
/// The returned router carries its own fallback, so an unknown path under the
/// API prefix is a problem document rather than something the static UI
/// fallback might answer with an HTML page.
pub fn router(state: ApiState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/tree", get(tree))
        .route("/search", get(search))
        .route("/events", get(events))
        .route("/rescan", post(rescan))
        .route("/bookmarks", post(create_bookmark))
        .route("/bookmarks/{id}", get(get_entry))
        .route("/bookmarks/{id}", patch(update_entry))
        .route("/bookmarks/{id}", delete(delete_bookmark))
        .route("/bookmarks/{id}/move", post(move_entry))
        .route("/folders", post(create_folder))
        .route("/folders/{id}", delete(delete_folder))
        .route("/folders/{id}/order", put(set_order))
        .fallback(unknown_route)
        .with_state(state)
}

/// The handler for any path this daemon does not serve.
///
/// It is the API router's fallback, and also the whole daemon's fallback when
/// no UI directory was configured.
pub(crate) async fn unknown_route() -> Problem {
    Problem::new(
        ProblemCode::RouteNotFound,
        "no such route; the API lives under /api/v1",
    )
}

async fn health(State(state): State<ApiState>) -> Json<HealthResponse> {
    let snapshot = state.vault.snapshot();
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        generation: snapshot.generation,
        // The vault's own diagnostics, plus anything the daemon has to say —
        // notably entries a crashed run left staged, which no scan can see.
        warnings: warnings(&state, &snapshot.scan),
    })
}

async fn tree(State(state): State<ApiState>) -> Json<TreeResponse> {
    let snapshot = state.vault.snapshot();
    Json(dto::tree(&snapshot.scan))
}

async fn search(
    State(state): State<ApiState>,
    ApiQuery(query): ApiQuery<SearchQuery>,
) -> Result<Json<SearchResponse>, Problem> {
    let query_text = query.q.trim();
    if query_text.chars().count() > MAX_SEARCH_QUERY_CHARS {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            format!("`q` must be at most {MAX_SEARCH_QUERY_CHARS} characters"),
        ));
    }
    if !(1..=MAX_SEARCH_LIMIT).contains(&query.limit) {
        return Err(Problem::new(
            ProblemCode::InvalidRequest,
            format!("`limit` must be between 1 and {MAX_SEARCH_LIMIT}"),
        ));
    }

    if query_text.is_empty() {
        return Ok(Json(SearchResponse {
            results: Vec::new(),
        }));
    }

    let snapshot = state.vault.snapshot();
    Ok(Json(dto::search(&snapshot.scan, query_text, query.limit)))
}

async fn rescan(State(state): State<ApiState>) -> Result<Json<RescanResponse>, Problem> {
    let vault = Arc::clone(&state.vault);
    let (snapshot, changed) = blocking(move || vault.reconcile()).await?;
    Ok(Json(RescanResponse {
        generation: snapshot.generation,
        changed,
        warnings: warnings(&state, &snapshot.scan),
    }))
}

async fn get_entry(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<BookmarkDto>, Problem> {
    let reference = parse_reference(&id)?;
    let vault = Arc::clone(&state.vault);
    blocking(move || vault.get(&reference)).await.map(Json)
}

async fn create_bookmark(
    State(state): State<ApiState>,
    ApiJson(request): ApiJson<CreateBookmarkRequest>,
) -> Result<(StatusCode, Json<BookmarkDto>), Problem> {
    let parent = parse_reference(&request.parent_id)?;
    let vault = Arc::clone(&state.vault);
    let created = logged(
        "create_bookmark",
        &request.parent_id,
        blocking(move || {
            let placement = Placement {
                index: request.index,
                parent_state_revision: request.parent_state_revision,
            };
            vault.create(&parent, &request.title, request.url.as_deref(), &placement)
        })
        .await,
    )?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn create_folder(
    State(state): State<ApiState>,
    ApiJson(request): ApiJson<CreateFolderRequest>,
) -> Result<(StatusCode, Json<BookmarkDto>), Problem> {
    let parent = parse_reference(&request.parent_id)?;
    let vault = Arc::clone(&state.vault);
    let created = logged(
        "create_folder",
        &request.parent_id,
        blocking(move || {
            let placement = Placement {
                index: request.index,
                parent_state_revision: request.parent_state_revision,
            };
            vault.create(&parent, &request.title, None, &placement)
        })
        .await,
    )?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn update_entry(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<UpdateRequest>,
) -> Result<Json<BookmarkDto>, Problem> {
    let reference = parse_reference(&id)?;
    let vault = Arc::clone(&state.vault);
    let updated = blocking(move || {
        vault.update(
            &reference,
            &request.revision,
            request.title.as_deref(),
            request.url.as_deref(),
        )
    })
    .await;
    logged("update", &id, updated).map(Json)
}

async fn move_entry(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<MoveRequest>,
) -> Result<Json<BookmarkDto>, Problem> {
    let reference = parse_reference(&id)?;
    let parent = parse_reference(&request.parent_id)?;
    let vault = Arc::clone(&state.vault);
    let plan = MovePlan {
        revision: request.revision,
        parent,
        index: request.index,
        source_state_revision: request.source_state_revision,
        destination_state_revision: request.destination_state_revision,
    };
    let moved = blocking(move || vault.move_entry(&reference, &plan)).await;
    logged("move", &id, moved).map(Json)
}

async fn delete_bookmark(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiQuery(query): ApiQuery<DeleteQuery>,
) -> Result<StatusCode, Problem> {
    let reference = parse_reference(&id)?;
    let vault = Arc::clone(&state.vault);
    let deleted = blocking(move || {
        vault.delete_bookmark(
            &reference,
            &query.revision,
            query.parent_state_revision.as_deref(),
        )
    })
    .await;
    logged("delete_bookmark", &id, deleted)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_folder(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiQuery(query): ApiQuery<DeleteQuery>,
) -> Result<StatusCode, Problem> {
    let reference = parse_reference(&id)?;
    let vault = Arc::clone(&state.vault);
    let deleted = blocking(move || {
        vault.delete_folder(
            &reference,
            &query.revision,
            query.parent_state_revision.as_deref(),
            query.recursive,
        )
    })
    .await;
    logged("delete_folder", &id, deleted)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Replaces a folder's child order.
///
/// `PUT` rather than `PATCH` because the body is the whole order, not a change
/// to it: sending the same order twice is the same request twice, and the
/// second one writes nothing.
async fn set_order(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<OrderRequest>,
) -> Result<Json<BookmarkDto>, Problem> {
    let reference = parse_reference(&id)?;
    let children = request
        .children
        .iter()
        .map(parse_order_child)
        .collect::<Result<Vec<_>, _>>()?;
    let vault = Arc::clone(&state.vault);
    let ordered =
        blocking(move || vault.set_order(&reference, request.state_revision.as_deref(), &children))
            .await;
    logged("set_order", &id, ordered).map(Json)
}

fn parse_order_child(child: &OrderChild) -> Result<(Id, ChildKind), Problem> {
    let id = Id::parse(&child.id).map_err(|error| {
        Problem::new(
            ProblemCode::InvalidRequest,
            format!("`{}` is not an entry id: {error}", child.id),
        )
    })?;
    let kind = ChildKind::parse(&child.kind).ok_or_else(|| {
        Problem::new(
            ProblemCode::InvalidRequest,
            format!("`{}` is not a kind; use `bookmark` or `folder`", child.kind),
        )
    })?;
    Ok((id, kind))
}

/// Streams one `changed` event per generation.
///
/// The stream opens with the *current* generation rather than waiting for the
/// next change, so a client that connects after a change it missed still learns
/// immediately that its copy of the tree is behind. That also makes reconnects
/// self-correcting: a client that drops and returns is resynchronised by the
/// first event it receives.
async fn events(
    State(state): State<ApiState>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let vault = Arc::clone(&state.vault);
    let receiver = vault.subscribe();
    let current = vault.snapshot().generation;

    let lagged_vault = Arc::clone(&vault);
    let stream = tokio_stream::iter([Ok(changed_event(current))]).chain(
        BroadcastStream::new(receiver).map(move |item| {
            // A client too slow to keep up is not disconnected; it is handed
            // the generation it should be at, which is all it needed anyway.
            let generation = item.unwrap_or_else(|_| lagged_vault.snapshot().generation);
            Ok(changed_event(generation))
        }),
    );

    Sse::new(stream).keep_alive(KeepAlive::new().interval(SSE_KEEP_ALIVE))
}

fn changed_event(generation: u64) -> Event {
    Event::default()
        .event("changed")
        .data(format!(r#"{{"generation":{generation}}}"#))
}

/// Records the outcome of a mutation.
///
/// Only the operation, the entry address and the failure code are recorded. A
/// title, a URL and a file's contents are the user's private data and never
/// reach a log line, however convenient they would be to debug with.
fn logged<T>(
    operation: &'static str,
    target: &str,
    result: Result<T, Problem>,
) -> Result<T, Problem> {
    match &result {
        Ok(_) => tracing::info!(operation, target, "applied"),
        Err(problem) => {
            tracing::info!(operation, target, code = %problem.code(), "refused");
        }
    }
    result
}

/// Everything worth warning a client about, from the vault and the daemon.
fn warnings(state: &ApiState, scan: &bbb_vault_core::VaultScan) -> Vec<crate::dto::DiagnosticDto> {
    let mut warnings = state.vault.notices();
    warnings.extend(dto::warnings(scan));
    warnings
}

fn parse_reference(text: &str) -> Result<EntryRef, Problem> {
    EntryRef::parse(text)
        .map_err(|error| Problem::new(ProblemCode::InvalidRequest, error.to_string()))
}

/// Runs a blocking vault operation off the async runtime.
async fn blocking<T, F>(operation: F) -> Result<T, Problem>
where
    F: FnOnce() -> Result<T, Problem> + Send + 'static,
    T: Send + 'static,
{
    match tokio::task::spawn_blocking(operation).await {
        Ok(result) => result,
        // A join error means the worker panicked or the runtime is shutting
        // down. Either way the caller gets a truthful "it did not happen".
        Err(_) => Err(Problem::new(
            ProblemCode::VaultUnavailable,
            "the vault operation did not complete",
        )),
    }
}
