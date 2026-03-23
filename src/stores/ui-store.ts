import { create } from "zustand"
import type { BookmarkNode } from "@/browser"

interface DeletingItem {
  id: string
  title: string
  type: "bookmark" | "folder"
  childCount?: number
}

interface UIState {
  settingsOpen: boolean
  editingBookmark: BookmarkNode | null
  deletingItem: DeletingItem | null

  // Actions
  openSettings(): void
  closeSettings(): void
  openEditor(bookmark: BookmarkNode): void
  closeEditor(): void
  openDeleteConfirm(item: DeletingItem): void
  closeDeleteConfirm(): void
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  editingBookmark: null,
  deletingItem: null,

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openEditor: (bookmark) => set({ editingBookmark: bookmark }),
  closeEditor: () => set({ editingBookmark: null }),
  openDeleteConfirm: (item) => set({ deletingItem: item }),
  closeDeleteConfirm: () => set({ deletingItem: null }),
}))
