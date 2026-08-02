import type { BookmarkDiagnostic, BookmarkNode } from "../types"

/** The path prefix every daemon route lives under. Mirrors `server::API_PREFIX`. */
export const API_BASE = "/api/v1"
const DEFAULT_TIMEOUT_MS = 10_000

export class DaemonApiError extends Error {
  readonly status?: number
  readonly code?: string
  readonly title?: string
  readonly detail?: string
  readonly isTimeout: boolean

  constructor(
    message: string,
    opts: {
      status?: number
      code?: string
      title?: string
      detail?: string
      isTimeout?: boolean
    } = {}
  ) {
    super(message)
    this.name = "DaemonApiError"
    this.status = opts.status
    this.code = opts.code
    this.title = opts.title
    this.detail = opts.detail
    this.isTimeout = opts.isTimeout ?? false
  }
}

/**
 * The daemon's `application/problem+json` shape. `code` is one of:
 * `not_found`, `route_not_found`, `invalid_request`, `stale_revision`,
 * `read_only`, `invalid_value`, `folder_not_empty`, `ambiguous_id`,
 * `subtree_has_unknown_files`, `subtree_changed`, `partial_failure`,
 * `unsupported_operation`, `move_into_self`, `invalid_order`,
 * `state_read_only`, `stale_state_revision`, `host_not_allowed`,
 * `vault_unavailable`.
 */
interface ProblemJson {
  type?: string
  title?: string
  status?: number
  code?: string
  detail?: string
  instance?: string
}

async function parseErrorBody(response: Response): Promise<ProblemJson | null> {
  try {
    const text = await response.text()
    if (!text) return null
    return JSON.parse(text) as ProblemJson
  } catch {
    return null
  }
}

export interface DaemonHealth {
  status: string
  version?: string
  generation?: number
  warnings?: BookmarkDiagnostic[]
}

export interface DaemonTreeResponse {
  tree: BookmarkNode[]
}

export interface DaemonSearchResult {
  id: string
  title: string
  url: string
}

export interface DaemonSearchResponse {
  results: DaemonSearchResult[]
}

export type DaemonNodeKind = "bookmark" | "folder"

function segmentFor(kind: DaemonNodeKind): string {
  return kind === "bookmark" ? "bookmarks" : "folders"
}

/** One entry of a requested child order. `kind` is checked server-side. */
export interface OrderChild {
  id: string
  kind: DaemonNodeKind
}

export interface OrderRequestBody {
  /**
   * The folder's current order-file revision, or the key left out entirely
   * when it has none. Absence is a claim the daemon verifies — sending
   * `undefined` is correct only because `JSON.stringify` drops the key; never
   * send an empty string.
   */
  stateRevision?: string
  /** Every addressable child of the folder, in the order it should be in. */
  children: OrderChild[]
}

export interface DaemonClientOptions {
  /**
   * The daemon's origin, canonical `http://host:port`, or `""` for same
   * origin.
   *
   * Same origin is what the daemon-served build wants: the page *is* the
   * daemon, so every request stays relative and no CORS preflight is ever
   * provoked. An extension has no such luxury and passes an absolute loopback
   * origin, which must already have been through `canonicalizeDaemonOrigin`.
   */
  origin?: string
  /**
   * An optional bearer token, sent as an `Authorization` header.
   *
   * There is no pairing in this milestone, so nothing sets this yet. It is
   * plumbed anyway because retrofitting it later would touch the SSE stream,
   * every request path and the adapter's construction at once. It is never put
   * in a URL and never logged — a query parameter would land in the daemon's
   * request log and in the browser's history.
   */
  bearerToken?: string
  timeoutMs?: number
  /** Test-only seam: inject a fetch implementation. */
  fetchImpl?: typeof fetch
}

/**
 * One configured connection to a daemon.
 *
 * Previously this module was a set of free functions bound to `/api/v1` on
 * whatever origin the page happened to be served from, which is exactly right
 * for the daemon-served UI and unusable from an extension, whose origin is
 * `chrome-extension://…`. An instance carries its own origin, credentials and
 * timeout, so the served UI and one or more extension connections can coexist
 * in the same build without a global to switch between them.
 *
 * Error semantics are unchanged: every non-2xx response becomes a
 * {@link DaemonApiError} carrying the `problem+json` `code`, `title`, `detail`
 * and status, and a timeout becomes one with `isTimeout` set. Messages name
 * the API *path* rather than the full URL, so an origin (and anything ever
 * attached to it) cannot leak into a message that gets logged or rendered.
 */
export class DaemonClient {
  /** The configured origin: `""` when same-origin. */
  readonly origin: string
  readonly timeoutMs: number
  private readonly bearerToken?: string
  private readonly fetchImpl?: typeof fetch

  constructor(options: DaemonClientOptions = {}) {
    const origin = options.origin?.trim() ?? ""
    this.origin = origin.endsWith("/") ? origin.slice(0, -1) : origin
    this.bearerToken = options.bearerToken
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = options.fetchImpl
  }

  /** The absolute (or same-origin relative) URL of an API path. Never carries the token. */
  url(path: string): string {
    return `${this.origin}${API_BASE}${path}`
  }

  /** The change stream's URL. */
  get eventsUrl(): string {
    return this.url("/events")
  }

  /**
   * The headers that authenticate a request, empty when no token is
   * configured. Exposed so the SSE connection can send the same ones — it is a
   * plain `fetch`, not an `EventSource`, precisely so that it can.
   */
  authHeaders(): Record<string, string> {
    return this.bearerToken
      ? { Authorization: `Bearer ${this.bearerToken}` }
      : {}
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    // Resolved per call, not per instance, so a test that stubs the global
    // after construction still sees its stub.
    const doFetch = this.fetchImpl ?? globalThis.fetch

    let response: Response
    try {
      response = await doFetch.call(globalThis, this.url(path), {
        ...init,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...this.authHeaders(),
          ...init.headers,
        },
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DaemonApiError(`Request to ${path} timed out`, {
          isTimeout: true,
        })
      }
      throw new DaemonApiError(
        error instanceof Error ? error.message : `Request to ${path} failed`
      )
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) {
      const problem = await parseErrorBody(response)
      throw new DaemonApiError(
        problem?.detail ??
          problem?.title ??
          `${response.status} ${response.statusText}`,
        {
          status: response.status,
          code: problem?.code,
          title: problem?.title,
          detail: problem?.detail,
        }
      )
    }

    if (response.status === 204) {
      return undefined as T
    }

    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  fetchHealth(): Promise<DaemonHealth> {
    return this.request<DaemonHealth>("/health")
  }

  fetchTree(): Promise<DaemonTreeResponse> {
    return this.request<DaemonTreeResponse>("/tree")
  }

  /** Bookmark-only, case-insensitive search over the daemon's current snapshot. */
  search(query: string, limit = 8): Promise<DaemonSearchResponse> {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    return this.request<DaemonSearchResponse>(`/search?${params.toString()}`)
  }

  /** Bare DTO, not wrapped — the daemon exposes a single item under /bookmarks/:id regardless of kind. */
  fetchNode(id: string): Promise<BookmarkNode> {
    return this.request<BookmarkNode>(`/bookmarks/${encodeURIComponent(id)}`)
  }

  createNode(
    kind: DaemonNodeKind,
    body: { parentId: string; title: string; url?: string }
  ): Promise<BookmarkNode> {
    return this.request<BookmarkNode>(`/${segmentFor(kind)}`, {
      method: "POST",
      body: JSON.stringify(body),
    })
  }

  /** PATCH always targets /bookmarks/:id, even for a folder. */
  updateNode(
    id: string,
    body: { revision: string; title?: string; url?: string }
  ): Promise<BookmarkNode> {
    return this.request<BookmarkNode>(`/bookmarks/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    })
  }

  /** DELETE keeps kind routing; a folder delete of a non-empty directory needs `recursive`. */
  deleteNode(
    kind: DaemonNodeKind,
    id: string,
    revision: string,
    opts: { recursive?: boolean } = {}
  ): Promise<void> {
    const params = new URLSearchParams({ revision })
    if (opts.recursive) params.set("recursive", "true")
    return this.request<void>(
      `/${segmentFor(kind)}/${encodeURIComponent(id)}?${params.toString()}`,
      { method: "DELETE" }
    )
  }

  /** Move always targets /bookmarks/:id, even for a folder. */
  moveNode(
    id: string,
    body: { revision: string; parentId: string }
  ): Promise<BookmarkNode | undefined> {
    return this.request<BookmarkNode | undefined>(
      `/bookmarks/${encodeURIComponent(id)}/move`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    )
  }

  /**
   * Replaces a folder's whole child order.
   *
   * PUT rather than PATCH because the body is the entire order, not a change to
   * it: sending the same order twice is the same request twice and the second
   * writes nothing. Responds with the folder's own DTO, including its refreshed
   * `revision` and `stateRevision` and its full subtree.
   */
  setOrder(id: string, body: OrderRequestBody): Promise<BookmarkNode> {
    return this.request<BookmarkNode>(
      `/folders/${encodeURIComponent(id)}/order`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      }
    )
  }
}

/**
 * A client for the daemon that served this page.
 *
 * The daemon-served build's origin *is* the daemon, so every request stays
 * relative — which is what it has always done, and what keeps it free of CORS.
 */
export function createSameOriginDaemonClient(
  options: Omit<DaemonClientOptions, "origin"> = {}
): DaemonClient {
  return new DaemonClient({ ...options, origin: "" })
}
