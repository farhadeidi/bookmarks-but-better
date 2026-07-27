import type { BookmarkNode } from "../types"

/**
 * Wire contract assumed for the daemon HTTP API. The daemon itself lives in
 * a separate workspace and hadn't landed yet when this client was written,
 * so these shapes are this slice's documented assumption, not a verified
 * contract. See the module-level endpoints below for the exact paths.
 */
const API_BASE = "/api/v1"
const DEFAULT_TIMEOUT_MS = 10_000

export class DaemonApiError extends Error {
  readonly status?: number
  readonly title?: string
  readonly detail?: string
  readonly isTimeout: boolean

  constructor(
    message: string,
    opts: {
      status?: number
      title?: string
      detail?: string
      isTimeout?: boolean
    } = {}
  ) {
    super(message)
    this.name = "DaemonApiError"
    this.status = opts.status
    this.title = opts.title
    this.detail = opts.detail
    this.isTimeout = opts.isTimeout ?? false
  }
}

interface ProblemJson {
  type?: string
  title?: string
  status?: number
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
}

export function fetchHealth(): Promise<DaemonHealth> {
  return request<DaemonHealth>("/health")
}

export interface DaemonTreeResponse {
  root: BookmarkNode
}

export interface DaemonNodeResponse {
  node: BookmarkNode
}

export function fetchTree(): Promise<DaemonTreeResponse> {
  return request<DaemonTreeResponse>("/tree")
}

export function fetchSubTree(id: string): Promise<DaemonNodeResponse> {
  return request<DaemonNodeResponse>(`/tree/${encodeURIComponent(id)}`)
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

export function updateNode(
  kind: DaemonNodeKind,
  id: string,
  body: { revision: string; title?: string; url?: string }
): Promise<BookmarkNode> {
  return request<BookmarkNode>(
    `/${segmentFor(kind)}/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
    }
  )
}

export function deleteNode(
  kind: DaemonNodeKind,
  id: string,
  revision: string
): Promise<void> {
  return request<void>(
    `/${segmentFor(kind)}/${encodeURIComponent(id)}?revision=${encodeURIComponent(revision)}`,
    { method: "DELETE" }
  )
}

export function moveNode(
  kind: DaemonNodeKind,
  id: string,
  body: { revision: string; parentId: string }
): Promise<BookmarkNode | undefined> {
  return request<BookmarkNode | undefined>(
    `/${segmentFor(kind)}/${encodeURIComponent(id)}/move`,
    {
      method: "POST",
      body: JSON.stringify(body),
    }
  )
}

export function triggerRescan(): Promise<void> {
  return request<void>("/rescan", { method: "POST" })
}

export const DAEMON_EVENTS_PATH = `${API_BASE}/events`
