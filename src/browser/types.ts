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
   * Whether persisted same-parent sibling reordering is supported. False in
   * daemon mode: sibling ordering is deterministic server-side and the
   * byte-preserving reorder mutation path hasn't shipped yet. Cross-folder
   * moves are a separate capability — see `move`.
   */
  reorder: boolean
}

export interface BrowserAdapter {
  bookmarks: BookmarkAdapter
  storage: StorageAdapter
  favicon: FaviconProvider
  capabilities: AdapterCapabilities
}
