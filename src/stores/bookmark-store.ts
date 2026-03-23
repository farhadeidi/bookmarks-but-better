import { create } from "zustand"
import type { BookmarkNode, BrowserAdapter } from "@/browser"

interface BookmarkState {
  tree: BookmarkNode[]
  rootFolderId: string | null
  isLoading: boolean
  adapter: BrowserAdapter | null

  // Derived
  rootFolder: BookmarkNode | null

  // Actions
  init(adapter: BrowserAdapter): Promise<void>
  setRootFolderId(id: string | null): void
  refresh(): Promise<void>
  createBookmark(parentId: string, title: string, url: string): Promise<void>
  updateBookmark(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<void>
  deleteBookmark(id: string): Promise<void>
  deleteFolder(id: string): Promise<void>
}

function findNode(
  nodes: BookmarkNode[],
  id: string
): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  tree: [],
  rootFolderId: null,
  isLoading: true,
  adapter: null,
  rootFolder: null,

  async init(adapter: BrowserAdapter) {
    set({ adapter, isLoading: true })

    const tree = await adapter.bookmarks.getTree()

    // Load saved root folder preference
    const savedRootId = await adapter.storage.get<string>("rootFolderId")

    const rootFolder = savedRootId ? findNode(tree, savedRootId) : null

    set({
      tree,
      rootFolderId: savedRootId,
      rootFolder,
      isLoading: false,
    })

    // Subscribe to Chrome bookmark events (no-ops for standalone)
    const unsubscribers = [
      adapter.bookmarks.onChanged(() => get().refresh()),
      adapter.bookmarks.onCreated(() => get().refresh()),
      adapter.bookmarks.onRemoved(() => get().refresh()),
      adapter.bookmarks.onMoved(() => get().refresh()),
    ]

    // Store cleanup function (called if needed)
    return () => {
      for (const unsub of unsubscribers) {
        unsub()
      }
    }
  },

  setRootFolderId(id: string | null) {
    const { tree, adapter } = get()
    const rootFolder = id ? findNode(tree, id) : null
    set({ rootFolderId: id, rootFolder })
    adapter?.storage.set("rootFolderId", id)
  },

  async refresh() {
    const { adapter, rootFolderId } = get()
    if (!adapter) return

    const tree = await adapter.bookmarks.getTree()
    const rootFolder = rootFolderId
      ? findNode(tree, rootFolderId)
      : null

    set({ tree, rootFolder })
  },

  async createBookmark(parentId: string, title: string, url: string) {
    const { adapter } = get()
    if (!adapter) return
    await adapter.bookmarks.create({ parentId, title, url })
    await get().refresh()
  },

  async updateBookmark(
    id: string,
    changes: { title?: string; url?: string }
  ) {
    const { adapter } = get()
    if (!adapter) return
    await adapter.bookmarks.update(id, changes)
    await get().refresh()
  },

  async deleteBookmark(id: string) {
    const { adapter } = get()
    if (!adapter) return
    await adapter.bookmarks.remove(id)
    await get().refresh()
  },

  async deleteFolder(id: string) {
    const { adapter } = get()
    if (!adapter) return
    await adapter.bookmarks.removeTree(id)
    await get().refresh()
  },
}))
