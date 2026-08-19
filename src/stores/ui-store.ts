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

interface SearchPaletteRequest {
  /**
   * What the palette starts with — the character that opened it by
   * type-ahead, or nothing when it was opened from the toolbar. A fresh
   * object per open is what re-seeds the input on every visit.
   */
  seedQuery: string
}

interface UIState {
  settingsOpen: boolean
  bookmarkOrganizerOpen: boolean
  onboardingOpen: boolean
  editingBookmark: BookmarkNode | null
  deletingItem: DeletingItem | null
  creatingItem: CreateItemRequest | null
  searchPalette: SearchPaletteRequest | null
  /**
   * The item the organizer should expand to and focus, for as long as this
   * visit lasts. It outlives the focus itself: the organizer widens its root
   * and unhides bookmarks to reach the item, and undoing that the moment
   * focus lands would hide the row the user was sent to look at.
   */
  organizerRevealId: string | null

  // Actions
  openSettings(): void
  closeSettings(): void
  openBookmarkOrganizer(): void
  closeBookmarkOrganizer(): void
  /** Opens the organizer pointed at one item, wherever in the source it sits. */
  revealInBookmarkOrganizer(id: string): void
  /**
   * Ends the reveal without closing the organizer — what the organizer's own
   * root and visibility controls do, so that touching one of them hands the
   * view back to the user instead of fighting the reveal that widened it.
   */
  clearOrganizerReveal(): void
  openSearchPalette(seedQuery?: string): void
  closeSearchPalette(): void
  openOnboarding(): void
  closeOnboarding(): void
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
  onboardingOpen: false,
  editingBookmark: null,
  deletingItem: null,
  creatingItem: null,
  searchPalette: null,
  organizerRevealId: null,

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openBookmarkOrganizer: () =>
    set({ bookmarkOrganizerOpen: true, organizerRevealId: null }),
  closeBookmarkOrganizer: () =>
    set({ bookmarkOrganizerOpen: false, organizerRevealId: null }),
  revealInBookmarkOrganizer: (id) =>
    set({
      bookmarkOrganizerOpen: true,
      organizerRevealId: id,
      // The palette is the only way to reach this, and leaving it stacked
      // over the organizer would hide the item it just went to find.
      searchPalette: null,
    }),
  clearOrganizerReveal: () => set({ organizerRevealId: null }),
  openSearchPalette: (seedQuery = "") => set({ searchPalette: { seedQuery } }),
  closeSearchPalette: () => set({ searchPalette: null }),
  openOnboarding: () => set({ onboardingOpen: true }),
  closeOnboarding: () => set({ onboardingOpen: false }),
  openEditor: (bookmark) => set({ editingBookmark: bookmark }),
  closeEditor: () => set({ editingBookmark: null }),
  openDeleteConfirm: (item) => set({ deletingItem: item }),
  closeDeleteConfirm: () => set({ deletingItem: null }),
  openCreateItem: (request) => set({ creatingItem: request }),
  closeCreateItem: () => set({ creatingItem: null }),
}))
