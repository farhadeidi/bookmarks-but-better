//! The versioned HTTP surface.
//!
//! Everything lives under `/api/v1`. The version is in the path rather than in
//! a header so that a served UI bundle and the daemon it talks to can be
//! upgraded independently and still fail loudly rather than subtly.
//!
//! # Vault scoping
//!
//! One daemon may host several Vaults (ADR-0001). Every Vault-specific
//! operation therefore exists in two spellings: the vault-scoped
//! `/vaults/{id}/…` routes, which name their target, and the legacy unscoped
//! routes, which are valid only while exactly one Vault is hosted. With more
//! than one Vault the unscoped routes answer `vault_required` — the daemon
//! never selects a hidden default on the client's behalf. `/health` and
//! `/vaults` are daemon-level concerns and work regardless of how many Vaults
//! are hosted.
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

use bookmarks_but_better_vault_core::{ChildKind, Id};

use crate::dto::{
    self, BookmarkDto, CreateBookmarkRequest, CreateFolderRequest, DeleteQuery, HealthResponse,
    MoveRequest, OrderChild, OrderRequest, Placement, RescanResponse, SearchQuery, SearchResponse,
    TreeResponse, UpdateRequest, VaultDto, VaultsResponse,
};
use crate::entry::EntryRef;
use crate::extract::{ApiJson, ApiQuery};
use crate::problem::{Problem, ProblemCode};
use crate::registry::VaultRegistry;
use crate::vault::{MovePlan, Vault};

/// How often an idle event stream is nudged so proxies and clients keep it open.
const SSE_KEEP_ALIVE: Duration = Duration::from_secs(15);
const MAX_SEARCH_QUERY_CHARS: usize = 256;
const MAX_SEARCH_LIMIT: usize = 20;

/// What every handler shares.
#[derive(Debug, Clone)]
pub struct ApiState {
    /// The Vaults this daemon hosts.
    pub registry: Arc<VaultRegistry>,
}

/// Builds the `/api/v1` routes.
///
/// The returned router carries its own fallback, so an unknown path under the
/// API prefix is a problem document rather than something the static UI
/// fallback might answer with an HTML page.
pub fn router(state: ApiState) -> Router {
    Router::new()
        // Daemon-level: work regardless of how many Vaults are hosted.
        .route("/health", get(health))
        .route("/vaults", get(list_vaults))
        // Vault-scoped: the target is named on every request.
        .route("/vaults/{vault}/health", get(scoped_health))
        .route("/vaults/{vault}/tree", get(scoped_tree))
        .route("/vaults/{vault}/search", get(scoped_search))
        .route("/vaults/{vault}/events", get(scoped_events))
        .route("/vaults/{vault}/rescan", post(scoped_rescan))
        .route("/vaults/{vault}/bookmarks", post(scoped_create_bookmark))
        .route("/vaults/{vault}/bookmarks/{id}", get(scoped_get_entry))
        .route("/vaults/{vault}/bookmarks/{id}", patch(scoped_update_entry))
        .route(
            "/vaults/{vault}/bookmarks/{id}",
            delete(scoped_delete_bookmark),
        )
        .route(
            "/vaults/{vault}/bookmarks/{id}/move",
            post(scoped_move_entry),
        )
        .route("/vaults/{vault}/folders", post(scoped_create_folder))
        .route("/vaults/{vault}/folders/{id}", delete(scoped_delete_folder))
        .route("/vaults/{vault}/folders/{id}/order", put(scoped_set_order))
        // Legacy unscoped: valid only while exactly one Vault is hosted.
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

/// Resolves a vault-scoped address to its Vault.
fn scoped_vault(state: &ApiState, id: &str) -> Result<Arc<Vault>, Problem> {
    state
        .registry
        .by_id(id)
        .map(|hosted| Arc::clone(&hosted.vault))
        .ok_or_else(|| {
            Problem::new(
                ProblemCode::UnknownVault,
                format!("no hosted vault has the id `{id}`"),
            )
        })
}

/// Resolves an unscoped address: the sole Vault, or a refusal that names the fix.
///
/// The refusal is the whole point of the legacy routes' retirement plan: with
/// several Vaults hosted, guessing one would make a client act on a set of
/// bookmarks it never chose.
fn unscoped_vault(state: &ApiState) -> Result<Arc<Vault>, Problem> {
    state.registry.sole().map_or_else(
        || {
            Err(Problem::new(
                ProblemCode::VaultRequired,
                format!(
                    "this daemon hosts {} vaults; name one with /vaults/{{id}}/… (see GET /api/v1/vaults)",
                    state.registry.len()
                ),
            ))
        },
        |hosted| Ok(Arc::clone(&hosted.vault)),
    )
}

/// `GET /health`: the daemon, not any one Vault.
async fn health(State(state): State<ApiState>) -> Json<HealthResponse> {
    Json(daemon_health(&state))
}

/// `GET /vaults`: discovery.
async fn list_vaults(State(state): State<ApiState>) -> Json<VaultsResponse> {
    Json(VaultsResponse {
        vaults: state
            .registry
            .all()
            .map(|hosted| VaultDto {
                id: hosted.id.clone(),
                name: hosted.name(),
            })
            .collect(),
    })
}

fn daemon_health(state: &ApiState) -> HealthResponse {
    let vaults: Vec<_> = state
        .registry
        .all()
        .map(|hosted| dto::VaultSummaryDto {
            id: hosted.id.clone(),
            name: hosted.name(),
        })
        .collect();

    // The legacy fields ride along only in the single-Vault shape, so a
    // single-Vault client — including every pre-Vault-id client — reads
    // exactly what it always read.
    match state.registry.sole() {
        Some(sole) => {
            let snapshot = sole.vault.snapshot();
            let mut warnings = sole.vault.notices();
            warnings.extend(dto::warnings(&snapshot.scan));
            HealthResponse {
                status: "ok",
                version: env!("CARGO_PKG_VERSION"),
                vaults,
                generation: Some(snapshot.generation),
                warnings: Some(warnings),
            }
        }
        None => HealthResponse {
            status: "ok",
            version: env!("CARGO_PKG_VERSION"),
            vaults,
            generation: None,
            warnings: None,
        },
    }
}

/// The vault-level health body: the legacy shape, aimed at one named Vault.
fn vault_health(vault: &Vault) -> HealthResponse {
    let snapshot = vault.snapshot();
    // The vault's own diagnostics, plus anything the daemon has to say —
    // notably entries a crashed run left staged, which no scan can see.
    let mut warnings = vault.notices();
    warnings.extend(dto::warnings(&snapshot.scan));
    HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
        vaults: Vec::new(),
        generation: Some(snapshot.generation),
        warnings: Some(warnings),
    }
}

async fn scoped_health(
    State(state): State<ApiState>,
    Path(vault_id): Path<String>,
) -> Result<Json<HealthResponse>, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    Ok(Json(vault_health(&vault)))
}

async fn scoped_tree(
    State(state): State<ApiState>,
    Path(vault_id): Path<String>,
) -> Result<Json<TreeResponse>, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    Ok(tree_of(&vault))
}

async fn tree(State(state): State<ApiState>) -> Result<Json<TreeResponse>, Problem> {
    let vault = unscoped_vault(&state)?;
    Ok(tree_of(&vault))
}

fn tree_of(vault: &Arc<Vault>) -> Json<TreeResponse> {
    let snapshot = vault.snapshot();
    Json(dto::tree(&snapshot.scan))
}

async fn scoped_search(
    State(state): State<ApiState>,
    Path(vault_id): Path<String>,
    ApiQuery(query): ApiQuery<SearchQuery>,
) -> Result<Json<SearchResponse>, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    search_of(&vault, &query).map(Json)
}

async fn search(
    State(state): State<ApiState>,
    ApiQuery(query): ApiQuery<SearchQuery>,
) -> Result<Json<SearchResponse>, Problem> {
    let vault = unscoped_vault(&state)?;
    search_of(&vault, &query).map(Json)
}

fn search_of(vault: &Vault, query: &SearchQuery) -> Result<SearchResponse, Problem> {
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
        return Ok(SearchResponse {
            results: Vec::new(),
        });
    }

    let snapshot = vault.snapshot();
    Ok(dto::search(&snapshot.scan, query_text, query.limit))
}

async fn scoped_rescan(
    State(state): State<ApiState>,
    Path(vault_id): Path<String>,
) -> Result<Json<RescanResponse>, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    rescan_of(vault).await
}

async fn rescan(State(state): State<ApiState>) -> Result<Json<RescanResponse>, Problem> {
    let vault = unscoped_vault(&state)?;
    rescan_of(vault).await
}

async fn rescan_of(vault: Arc<Vault>) -> Result<Json<RescanResponse>, Problem> {
    let for_reconcile = Arc::clone(&vault);
    let (snapshot, changed) = blocking(move || for_reconcile.reconcile()).await?;
    // The vault's own notices (staging residue no scan can see) alongside the
    // fresh scan's diagnostics, exactly as the single-vault handler always
    // reported them.
    let mut warnings = vault.notices();
    warnings.extend(dto::warnings(&snapshot.scan));
    Ok(Json(RescanResponse {
        generation: snapshot.generation,
        changed,
        warnings,
    }))
}

async fn scoped_get_entry(
    State(state): State<ApiState>,
    Path((vault_id, id)): Path<(String, String)>,
) -> Result<Json<BookmarkDto>, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    get_entry_of(&vault, &id).await
}

async fn get_entry(
    State(state): State<ApiState>,
    Path(id): Path<String>,
) -> Result<Json<BookmarkDto>, Problem> {
    let vault = unscoped_vault(&state)?;
    get_entry_of(&vault, &id).await
}

async fn get_entry_of(vault: &Arc<Vault>, id: &str) -> Result<Json<BookmarkDto>, Problem> {
    let reference = parse_reference(id)?;
    let vault = Arc::clone(vault);
    blocking(move || vault.get(&reference)).await.map(Json)
}

async fn scoped_create_bookmark(
    State(state): State<ApiState>,
    Path(vault_id): Path<String>,
    ApiJson(request): ApiJson<CreateBookmarkRequest>,
) -> Result<(StatusCode, Json<BookmarkDto>), Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    create_bookmark_of(&vault, request).await
}

async fn create_bookmark(
    State(state): State<ApiState>,
    ApiJson(request): ApiJson<CreateBookmarkRequest>,
) -> Result<(StatusCode, Json<BookmarkDto>), Problem> {
    let vault = unscoped_vault(&state)?;
    create_bookmark_of(&vault, request).await
}

async fn create_bookmark_of(
    vault: &Arc<Vault>,
    request: CreateBookmarkRequest,
) -> Result<(StatusCode, Json<BookmarkDto>), Problem> {
    let parent = parse_reference(&request.parent_id)?;
    let vault = Arc::clone(vault);
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

async fn scoped_create_folder(
    State(state): State<ApiState>,
    Path(vault_id): Path<String>,
    ApiJson(request): ApiJson<CreateFolderRequest>,
) -> Result<(StatusCode, Json<BookmarkDto>), Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    create_folder_of(&vault, request).await
}

async fn create_folder(
    State(state): State<ApiState>,
    ApiJson(request): ApiJson<CreateFolderRequest>,
) -> Result<(StatusCode, Json<BookmarkDto>), Problem> {
    let vault = unscoped_vault(&state)?;
    create_folder_of(&vault, request).await
}

async fn create_folder_of(
    vault: &Arc<Vault>,
    request: CreateFolderRequest,
) -> Result<(StatusCode, Json<BookmarkDto>), Problem> {
    let parent = parse_reference(&request.parent_id)?;
    let vault = Arc::clone(vault);
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

async fn scoped_update_entry(
    State(state): State<ApiState>,
    Path((vault_id, id)): Path<(String, String)>,
    ApiJson(request): ApiJson<UpdateRequest>,
) -> Result<Json<BookmarkDto>, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    update_entry_of(&vault, &id, request).await
}

async fn update_entry(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<UpdateRequest>,
) -> Result<Json<BookmarkDto>, Problem> {
    let vault = unscoped_vault(&state)?;
    update_entry_of(&vault, &id, request).await
}

async fn update_entry_of(
    vault: &Arc<Vault>,
    id: &str,
    request: UpdateRequest,
) -> Result<Json<BookmarkDto>, Problem> {
    let reference = parse_reference(id)?;
    let vault = Arc::clone(vault);
    let updated = blocking(move || {
        vault.update(
            &reference,
            &request.revision,
            request.title.as_deref(),
            request.url.as_deref(),
        )
    })
    .await;
    logged("update", id, updated).map(Json)
}

async fn scoped_move_entry(
    State(state): State<ApiState>,
    Path((vault_id, id)): Path<(String, String)>,
    ApiJson(request): ApiJson<MoveRequest>,
) -> Result<Json<BookmarkDto>, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    move_entry_of(&vault, &id, request).await
}

async fn move_entry(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<MoveRequest>,
) -> Result<Json<BookmarkDto>, Problem> {
    let vault = unscoped_vault(&state)?;
    move_entry_of(&vault, &id, request).await
}

async fn move_entry_of(
    vault: &Arc<Vault>,
    id: &str,
    request: MoveRequest,
) -> Result<Json<BookmarkDto>, Problem> {
    let reference = parse_reference(id)?;
    let parent = parse_reference(&request.parent_id)?;
    let plan = MovePlan {
        revision: request.revision,
        parent,
        index: request.index,
        source_state_revision: request.source_state_revision,
        destination_state_revision: request.destination_state_revision,
    };
    let vault = Arc::clone(vault);
    let moved = blocking(move || vault.move_entry(&reference, &plan)).await;
    logged("move", id, moved).map(Json)
}

async fn scoped_delete_bookmark(
    State(state): State<ApiState>,
    Path((vault_id, id)): Path<(String, String)>,
    ApiQuery(query): ApiQuery<DeleteQuery>,
) -> Result<StatusCode, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    delete_bookmark_of(&vault, &id, query).await
}

async fn delete_bookmark(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiQuery(query): ApiQuery<DeleteQuery>,
) -> Result<StatusCode, Problem> {
    let vault = unscoped_vault(&state)?;
    delete_bookmark_of(&vault, &id, query).await
}

async fn delete_bookmark_of(
    vault: &Arc<Vault>,
    id: &str,
    query: DeleteQuery,
) -> Result<StatusCode, Problem> {
    let reference = parse_reference(id)?;
    let vault = Arc::clone(vault);
    let deleted = blocking(move || {
        vault.delete_bookmark(
            &reference,
            &query.revision,
            query.parent_state_revision.as_deref(),
        )
    })
    .await;
    logged("delete_bookmark", id, deleted)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn scoped_delete_folder(
    State(state): State<ApiState>,
    Path((vault_id, id)): Path<(String, String)>,
    ApiQuery(query): ApiQuery<DeleteQuery>,
) -> Result<StatusCode, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    delete_folder_of(&vault, &id, query).await
}

async fn delete_folder(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiQuery(query): ApiQuery<DeleteQuery>,
) -> Result<StatusCode, Problem> {
    let vault = unscoped_vault(&state)?;
    delete_folder_of(&vault, &id, query).await
}

async fn delete_folder_of(
    vault: &Arc<Vault>,
    id: &str,
    query: DeleteQuery,
) -> Result<StatusCode, Problem> {
    let reference = parse_reference(id)?;
    let vault = Arc::clone(vault);
    let deleted = blocking(move || {
        vault.delete_folder(
            &reference,
            &query.revision,
            query.parent_state_revision.as_deref(),
            query.recursive,
        )
    })
    .await;
    logged("delete_folder", id, deleted)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn scoped_set_order(
    State(state): State<ApiState>,
    Path((vault_id, id)): Path<(String, String)>,
    ApiJson(request): ApiJson<OrderRequest>,
) -> Result<Json<BookmarkDto>, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    set_order_of(&vault, &id, request).await
}

async fn set_order(
    State(state): State<ApiState>,
    Path(id): Path<String>,
    ApiJson(request): ApiJson<OrderRequest>,
) -> Result<Json<BookmarkDto>, Problem> {
    let vault = unscoped_vault(&state)?;
    set_order_of(&vault, &id, request).await
}

/// Replaces a folder's child order.
///
/// `PUT` rather than `PATCH` because the body is the whole order, not a change
/// to it: sending the same order twice is the same request twice, and the
/// second one writes nothing.
async fn set_order_of(
    vault: &Arc<Vault>,
    id: &str,
    request: OrderRequest,
) -> Result<Json<BookmarkDto>, Problem> {
    let reference = parse_reference(id)?;
    let children = request
        .children
        .iter()
        .map(parse_order_child)
        .collect::<Result<Vec<_>, _>>()?;
    let vault = Arc::clone(vault);
    let ordered =
        blocking(move || vault.set_order(&reference, request.state_revision.as_deref(), &children))
            .await;
    logged("set_order", id, ordered).map(Json)
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

async fn scoped_events(
    State(state): State<ApiState>,
    Path(vault_id): Path<String>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, Problem> {
    let vault = scoped_vault(&state, &vault_id)?;
    Ok(events_of(vault))
}

async fn events(
    State(state): State<ApiState>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>>>, Problem> {
    let vault = unscoped_vault(&state)?;
    Ok(events_of(vault))
}

/// Streams one `changed` event per generation.
///
/// The stream opens with the *current* generation rather than waiting for the
/// next change, so a client that connects after a change it missed still learns
/// immediately that its copy of the tree is behind. That also makes reconnects
/// self-correcting: a client that drops and returns is resynchronised by the
/// first event it receives.
fn events_of(vault: Arc<Vault>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let receiver = vault.subscribe();
    let current = vault.snapshot().generation;
    // The vault handle moves into the stream, outliving the handler.
    let lagged_vault = vault;
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
