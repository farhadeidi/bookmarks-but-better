import { create } from "zustand"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { debounce } from "@/lib/bookmark-utils"

export type BookmarkStoreStatus = "loading" | "ready" | "unavailable"

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Something went wrong."
}

interface BookmarkState {
  tree: BookmarkNode[]
  rootFolderId: string | null
  isLoading: boolean
  adapter: BrowserAdapter | null
  status: BookmarkStoreStatus
  loadError: string | null
  mutationError: string | null

  // Derived
  rootFolder: BookmarkNode | null

  // Actions
  init(adapter: BrowserAdapter): Promise<void | (() => void)>
  setRootFolderId(id: string | null): void
  refresh(): Promise<void>
  retry(): Promise<void>
  clearMutationError(): void
  createBookmark(parentId: string, title: string, url: string): Promise<void>
  updateBookmark(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<void>
  deleteBookmark(id: string): Promise<void>
  deleteFolder(id: string): Promise<void>
  createFolder(parentId: string, title: string): Promise<void>
  moveBookmark(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<void>
}

function findNode(nodes: BookmarkNode[], id: string): BookmarkNode | null {
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
  status: "loading",
  loadError: null,
  mutationError: null,
  rootFolder: null,

  async init(adapter: BrowserAdapter) {
    set({ adapter, isLoading: true, status: "loading", loadError: null })

    let tree: BookmarkNode[] = []
    try {
      tree = await adapter.bookmarks.getTree()
      set({ status: "ready" })
    } catch (error) {
      set({ status: "unavailable", loadError: toErrorMessage(error) })
    }

    const savedRootId = await adapter.storage.get<string>("rootFolderId")

    const rootFolder = savedRootId ? findNode(tree, savedRootId) : null

    set({
      tree,
      rootFolderId: savedRootId,
      rootFolder,
      isLoading: false,
    })

    const debouncedRefresh = debounce(() => get().refresh(), 100)

    const unsubscribers = [
      adapter.bookmarks.onChanged(debouncedRefresh),
      adapter.bookmarks.onCreated(debouncedRefresh),
      adapter.bookmarks.onRemoved(debouncedRefresh),
      adapter.bookmarks.onMoved(debouncedRefresh),
    ]

    return () => {
      for (const unsub of unsubscribers) {
        unsub()
      }
      adapter.bookmarks.dispose?.()
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

    try {
      const tree = await adapter.bookmarks.getTree()
      const rootFolder = rootFolderId ? findNode(tree, rootFolderId) : null
      set({ tree, rootFolder, status: "ready", loadError: null })
    } catch (error) {
      set({ status: "unavailable", loadError: toErrorMessage(error) })
    }
  },

  async retry() {
    const { adapter } = get()
    if (!adapter) return
    set({ status: "loading", loadError: null })
    await get().refresh()
  },

  clearMutationError() {
    set({ mutationError: null })
  },

  async createBookmark(parentId: string, title: string, url: string) {
    const { adapter } = get()
    if (!adapter) return
    try {
      await adapter.bookmarks.create({ parentId, title, url })
      set({ mutationError: null })
    } catch (error) {
      set({ mutationError: toErrorMessage(error) })
    }
  },

  async updateBookmark(id: string, changes: { title?: string; url?: string }) {
    const { adapter } = get()
    if (!adapter) return
    try {
      await adapter.bookmarks.update(id, changes)
      set({ mutationError: null })
    } catch (error) {
      set({ mutationError: toErrorMessage(error) })
    }
  },

  async deleteBookmark(id: string) {
    const { adapter } = get()
    if (!adapter) return
    try {
      await adapter.bookmarks.remove(id)
      set({ mutationError: null })
    } catch (error) {
      set({ mutationError: toErrorMessage(error) })
    }
  },

  async deleteFolder(id: string) {
    const { adapter } = get()
    if (!adapter) return
    try {
      await adapter.bookmarks.removeTree(id)
      set({ mutationError: null })
    } catch (error) {
      set({ mutationError: toErrorMessage(error) })
    }
  },

  async createFolder(parentId: string, title: string) {
    const { adapter } = get()
    if (!adapter) return
    try {
      await adapter.bookmarks.create({ parentId, title })
      set({ mutationError: null })
    } catch (error) {
      set({ mutationError: toErrorMessage(error) })
    }
  },

  async moveBookmark(
    id: string,
    destination: { parentId?: string; index: number }
  ) {
    const { adapter } = get()
    if (!adapter) return
    try {
      await adapter.bookmarks.move(id, destination)
      set({ mutationError: null })
    } catch (error) {
      set({ mutationError: toErrorMessage(error) })
    }
  },
}))
