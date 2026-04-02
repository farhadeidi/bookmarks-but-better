import { create } from "zustand"
import type { BookmarkNode } from "@/browser"

interface DeletingItem {
  id: string
  title: string
  type: "bookmark" | "folder"
  childCount?: number
}

interface CreateItemRequest {
  type: "bookmark" | "folder"
  parentId: string
}

interface UIState {
  settingsOpen: boolean
  bookmarkOrganizerOpen: boolean
  folderOrderOpen: boolean
  editingBookmark: BookmarkNode | null
  deletingItem: DeletingItem | null
  creatingItem: CreateItemRequest | null

  // Actions
  openSettings(): void
  closeSettings(): void
  openBookmarkOrganizer(): void
  closeBookmarkOrganizer(): void
  openFolderOrder(): void
  closeFolderOrder(): void
  openEditor(bookmark: BookmarkNode): void
  closeEditor(): void
  openDeleteConfirm(item: DeletingItem): void
  closeDeleteConfirm(): void
  openCreateItem(request: CreateItemRequest): void
  closeCreateItem(): void
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  bookmarkOrganizerOpen: false,
  folderOrderOpen: false,
  editingBookmark: null,
  deletingItem: null,
  creatingItem: null,

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openBookmarkOrganizer: () => set({ bookmarkOrganizerOpen: true }),
  closeBookmarkOrganizer: () => set({ bookmarkOrganizerOpen: false }),
  openFolderOrder: () => set({ folderOrderOpen: true }),
  closeFolderOrder: () => set({ folderOrderOpen: false }),
  openEditor: (bookmark) => set({ editingBookmark: bookmark }),
  closeEditor: () => set({ editingBookmark: null }),
  openDeleteConfirm: (item) => set({ deletingItem: item }),
  closeDeleteConfirm: () => set({ deletingItem: null }),
  openCreateItem: (request) => set({ creatingItem: request }),
  closeCreateItem: () => set({ creatingItem: null }),
}))
