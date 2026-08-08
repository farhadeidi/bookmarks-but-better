/**
 * Which source of bookmarks the app is pointed at.
 *
 * `browser` and `standalone` are the two that have always existed. `daemon` is
 * an *extension* pointing at a local `bookmarks-but-better` daemon over loopback; the
 * daemon-served build does not use this type at all, since it is not a choice
 * there. Nothing ever falls back from `daemon` to `browser` on its own — an
 * unreachable daemon is an error the user sees, not a silent switch to a
 * different set of bookmarks.
 */
export type AdapterMode = "browser" | "standalone" | "daemon"

/**
 * Where an extension reaches its daemon, and how it authenticates.
 *
 * `origin` is always the canonical `http://host:port` form produced by
 * `canonicalizeDaemonOrigin` — never a raw user string. `bearerToken` is
 * unused in this milestone (there is no pairing yet) but is carried end to end
 * so that adding pairing later needs no change to the client, the adapter or
 * this type. It travels in an `Authorization` header only: never in a URL,
 * never in a log line.
 */
export interface DaemonConnectionConfig {
  origin: string
  bearerToken?: string
}

export interface BookmarkDiagnostic {
  code: string
  severity: string
  detail: string
  path?: string
  line?: number
}

export interface BookmarkNode {
  id: string
  title: string
  url?: string
  parentId?: string
  children?: BookmarkNode[]
  dateAdded?: number
  /** Content revision used for optimistic-concurrency mutations. Daemon-only. */
  revision?: string
  /**
   * Revision of this folder's child-order file, for optimistic concurrency on
   * positional changes. Daemon-only, folders only.
   *
   * Absent is a claim in its own right — "this folder had no order file when I
   * looked" — so it must never be invented or sent as an empty string.
   */
  stateRevision?: string
  /**
   * True when this folder's child order must not be rewritten. Daemon-only.
   *
   * Distinct from `readOnly`: entries inside such a folder can still be
   * created, renamed, moved and deleted — only *positional* changes are
   * refused.
   */
  orderReadOnly?: boolean
  /** True when the daemon cannot safely mutate this node. Daemon-only. */
  readOnly?: boolean
  /** Why a node is read-only or otherwise flagged. Daemon-only. */
  diagnostics?: BookmarkDiagnostic[]
}

export interface BookmarkAdapter {
  getTree(): Promise<BookmarkNode[]>
  getSubTree(id: string): Promise<BookmarkNode[]>
  create(bookmark: {
    parentId: string
    title: string
    url?: string
  }): Promise<BookmarkNode>
  update(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode>
  remove(id: string): Promise<void>
  removeTree(id: string): Promise<void>
  move(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<void>
  /**
   * Atomically replaces a folder's *whole* child order in one request.
   *
   * Optional, and deliberately separate from `move()`: only the daemon can
   * persist an ordering independently of a reparent, and widening `move()`
   * would change what a cross-folder drag does everywhere else in the app.
   * Implementations take ids only — kind, addressability and the order file's
   * revision are all server truth, so the adapter re-reads the folder rather
   * than trusting a UI snapshot.
   *
   * `orderedChildIds` is a wish, not a contract: ids the folder no longer
   * holds are dropped, duplicates collapse to their first occurrence, and
   * children the caller didn't mention keep their server-side relative order
   * at the end.
   */
  setChildOrder?(folderId: string, orderedChildIds: string[]): Promise<void>
  onChanged(callback: () => void): () => void
  onCreated(callback: () => void): () => void
  onRemoved(callback: () => void): () => void
  onMoved(callback: () => void): () => void
  openInManager(id: string): Promise<void>
  /** Releases adapter-owned resources (e.g. an SSE connection). Optional: only the daemon adapter needs it. */
  dispose?(): void
  /** Cheap connectivity/readiness probe. Optional: only the daemon adapter needs it. */
  checkHealth?(): Promise<AdapterHealth>
}

export interface AdapterHealth {
  ready: boolean
  /** Vault-wide diagnostics, same shape as a node's own `diagnostics`. */
  warnings?: BookmarkDiagnostic[]
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

export interface FaviconProvider {
  getUrl(pageUrl: string): string
  getFallbackUrl?(pageUrl: string): string
  isAvailable(): boolean
}

export interface AdapterCapabilities {
  /** Whether "open in bookmark manager" is supported. False on Firefox and Standalone. */
  openInManager: boolean
  /** Whether a node can be moved to a different parent folder. */
  move: boolean
  /**
   * Whether persisted same-parent sibling reordering is supported *through
   * `move(id, {index})`* — the path the grid, the folder cards and the
   * DndMonitor all take. False in daemon mode: the daemon's `move()` has no
   * notion of an index, so anything routed through it would silently do
   * nothing. Cross-folder moves are a separate capability — see `move`.
   *
   * Do not flip this to `true` for the daemon "for consistency": whole-folder
   * ordering has its own capability below, and enabling this one would make
   * grid and card drags look enabled while writing nothing.
   */
  reorder: boolean
  /**
   * Whether a folder's whole child order can be replaced atomically through
   * `BookmarkAdapter.setChildOrder()`. True only in daemon mode.
   */
  setChildOrder: boolean
  /**
   * Whether `tree[0].id` — the root the tree returns when no folder has been
   * pinned as the dashboard root — is itself a real, creatable folder.
   *
   * True for daemon and standalone: their `tree[0]` is an addressable vault
   * root that `create()` accepts as a parent. False for Chrome and Firefox,
   * whose `tree[0]` is each browser's synthetic invisible root (id `"0"`,
   * see `src/features/settings/import-target.ts`) — both browsers reject it
   * as a create parent, so a real child folder must be picked first.
   *
   * Optional, not required like the other capabilities: adapters (and test
   * mocks) that predate this field are treated as `false`, the conservative
   * default that matches their actual (browser) behavior.
   */
  rootIsCreatable?: boolean
}

export interface BrowserAdapter {
  bookmarks: BookmarkAdapter
  storage: StorageAdapter
  favicon: FaviconProvider
  capabilities: AdapterCapabilities
}
