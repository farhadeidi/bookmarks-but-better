export interface BookmarkNode {
  id: string
  title: string
  url?: string
  parentId?: string
  children?: BookmarkNode[]
  dateAdded?: number
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
  onChanged(callback: () => void): () => void
  onCreated(callback: () => void): () => void
  onRemoved(callback: () => void): () => void
  onMoved(callback: () => void): () => void
  openInManager(id: string): Promise<void>
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

export interface BrowserAdapter {
  bookmarks: BookmarkAdapter
  storage: StorageAdapter
  favicon: FaviconProvider
}
