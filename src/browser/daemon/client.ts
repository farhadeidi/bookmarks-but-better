import type { BookmarkNode } from "../types"

const API_BASE = "/api/v1"
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

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let response: Response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
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

export interface DaemonHealth {
  status: string
  version?: string
  generation?: number
  warnings?: string[]
}

export function fetchHealth(): Promise<DaemonHealth> {
  return request<DaemonHealth>("/health")
}

export interface DaemonTreeResponse {
  tree: BookmarkNode[]
}

export function fetchTree(): Promise<DaemonTreeResponse> {
  return request<DaemonTreeResponse>("/tree")
}

/** Bare DTO, not wrapped — the daemon exposes a single item under /bookmarks/:id regardless of kind. */
export function fetchNode(id: string): Promise<BookmarkNode> {
  return request<BookmarkNode>(`/bookmarks/${encodeURIComponent(id)}`)
}

export type DaemonNodeKind = "bookmark" | "folder"

function segmentFor(kind: DaemonNodeKind): string {
  return kind === "bookmark" ? "bookmarks" : "folders"
}

export function createNode(
  kind: DaemonNodeKind,
  body: { parentId: string; title: string; url?: string }
): Promise<BookmarkNode> {
  return request<BookmarkNode>(`/${segmentFor(kind)}`, {
    method: "POST",
    body: JSON.stringify(body),
  })
}

/** PATCH always targets /bookmarks/:id, even for a folder. */
export function updateNode(
  id: string,
  body: { revision: string; title?: string; url?: string }
): Promise<BookmarkNode> {
  return request<BookmarkNode>(`/bookmarks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  })
}

/** DELETE keeps kind routing; a folder delete of a non-empty directory needs `recursive`. */
export function deleteNode(
  kind: DaemonNodeKind,
  id: string,
  revision: string,
  opts: { recursive?: boolean } = {}
): Promise<void> {
  const params = new URLSearchParams({ revision })
  if (opts.recursive) params.set("recursive", "true")
  return request<void>(
    `/${segmentFor(kind)}/${encodeURIComponent(id)}?${params.toString()}`,
    { method: "DELETE" }
  )
}

/** Move always targets /bookmarks/:id, even for a folder. */
export function moveNode(
  id: string,
  body: { revision: string; parentId: string }
): Promise<BookmarkNode | undefined> {
  return request<BookmarkNode | undefined>(
    `/bookmarks/${encodeURIComponent(id)}/move`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  )
}

export const DAEMON_EVENTS_PATH = `${API_BASE}/events`
