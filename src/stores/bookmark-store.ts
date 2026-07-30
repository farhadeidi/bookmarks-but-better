import { create } from "zustand"
import type {
  BookmarkDiagnostic,
  BookmarkNode,
  BrowserAdapter,
} from "@/browser"
import { debounce } from "@/lib/bookmark-utils"

export type BookmarkStoreStatus = "loading" | "ready" | "unavailable"

/**
 * Duck-typed against `DaemonApiError` (src/browser/daemon/client.ts) without
 * importing it directly, so this store stays adapter-agnostic — other
 * adapters' errors are plain `Error`s and fall through to the generic path.
 *
 * `code` is the daemon's stable `application/problem+json` code (see
 * `crates/bbb/src/problem.rs::ProblemCode` in the daemon repo) — switched on
 * directly rather than on HTTP status, since several distinct codes share a
 * status (e.g. `stale_revision`, `folder_not_empty`, `ambiguous_id`, and
 * `subtree_changed` are all 409s with different meanings).
 */
interface KnownApiErrorShape {
  code?: string
  detail?: string
}

function withDetail(lead: string, detail?: string): string {
  return detail ? `${lead} ${detail}` : lead
}

function toErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "Something went wrong."

  const shape = error as Error & KnownApiErrorShape
  switch (shape.code) {
    case "stale_revision":
      return withDetail(
        "This item changed elsewhere. Refresh and try again.",
        shape.detail
      )
    case "subtree_changed":
      return withDetail(
        "This folder changed while being deleted. Rescan and try again.",
        shape.detail
      )
    case "subtree_has_unknown_files":
      return withDetail(
        "This folder contains files the vault doesn't manage, so deleting it isn't safe.",
        shape.detail
      )
    case "folder_not_empty":
      return withDetail(
        "This folder isn't empty. Delete it recursively to remove its contents too.",
        shape.detail
      )
    case "ambiguous_id":
      return withDetail(
        "More than one item matches this reference.",
        shape.detail
      )
    case "read_only":
      return withDetail(
        "This item is read-only and can't be edited.",
        shape.detail
      )
    case "stale_state_revision":
      return withDetail(
        "This folder's order changed elsewhere. Refresh and try again.",
        shape.detail
      )
    case "state_read_only":
      return withDetail(
        "This folder's order can't be changed, but its items can still be renamed, moved and deleted.",
        shape.detail
      )
    case "invalid_order":
      return withDetail(
        "This folder's contents changed. Refresh and try again.",
        shape.detail
      )
    case "partial_failure":
      return withDetail("The change was only partly applied.", shape.detail)
    default:
      return error.message
  }
}

function describeHealthWarnings(warnings: BookmarkDiagnostic[]): string {
  return warnings.map((warning) => warning.detail).join(" ")
}

async function loadTree(adapter: BrowserAdapter): Promise<BookmarkNode[]> {
  if (adapter.bookmarks.checkHealth) {
    const health = await adapter.bookmarks.checkHealth()
    if (!health.ready) {
      throw new Error(
        health.warnings?.length
          ? describeHealthWarnings(health.warnings)
          : "The daemon is not ready."
      )
    }
  }
  return adapter.bookmarks.getTree()
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
  /**
   * Resolves `true` when the move was applied. Callers that only open a
   * dialog can keep ignoring the result and read `mutationError` afterwards;
   * the organizer needs to know inline whether to keep going.
   */
  moveBookmark(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<boolean>
  /**
   * Replaces a folder's whole child order. Resolves `false` (and sets
   * `mutationError`) when the adapter can't order, or the daemon refused.
   */
  setChildOrder(folderId: string, orderedChildIds: string[]): Promise<boolean>
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
      tree = await loadTree(adapter)
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
    const { adapter, rootFolderId } = get()
    if (!adapter) return
    set({ status: "loading", loadError: null })
    try {
      const tree = await loadTree(adapter)
      const rootFolder = rootFolderId ? findNode(tree, rootFolderId) : null
      set({ tree, rootFolder, status: "ready", loadError: null })
    } catch (error) {
      set({ status: "unavailable", loadError: toErrorMessage(error) })
    }
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
    if (!adapter) return false
    try {
      await adapter.bookmarks.move(id, destination)
      set({ mutationError: null })
      return true
    } catch (error) {
      set({ mutationError: toErrorMessage(error) })
      return false
    }
  },

  async setChildOrder(folderId: string, orderedChildIds: string[]) {
    const { adapter } = get()
    if (!adapter?.bookmarks.setChildOrder) return false
    try {
      await adapter.bookmarks.setChildOrder(folderId, orderedChildIds)
      set({ mutationError: null })
      return true
    } catch (error) {
      set({ mutationError: toErrorMessage(error) })
      return false
    }
  },
}))
