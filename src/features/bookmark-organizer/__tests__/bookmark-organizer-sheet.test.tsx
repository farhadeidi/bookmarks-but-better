// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { BookmarkOrganizerSheet } from "../bookmark-organizer-sheet"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"

describe("BookmarkOrganizerSheet", () => {
  beforeEach(() => {
    useUIStore.setState({
      settingsOpen: false,
      bookmarkOrganizerOpen: true,
      editingBookmark: null,
      deletingItem: null,
      creatingItem: null,
    })

    useBookmarkStore.setState({
      tree: [],
      rootFolderId: null,
      isLoading: false,
      adapter: {
        bookmarks: {
          getTree: vi.fn().mockResolvedValue([]),
          getSubTree: vi.fn().mockResolvedValue([]),
          create: vi.fn(),
          update: vi.fn(),
          remove: vi.fn(),
          removeTree: vi.fn(),
          move: vi.fn(),
          onChanged: vi.fn(() => () => {}),
          onCreated: vi.fn(() => () => {}),
          onRemoved: vi.fn(() => () => {}),
          onMoved: vi.fn(() => () => {}),
          openInManager: vi.fn(),
        },
        storage: {
          get: vi.fn(),
          set: vi.fn(),
          remove: vi.fn(),
        },
        favicon: {
          getUrl: vi.fn(() => ""),
          isAvailable: vi.fn(() => false),
        },
        capabilities: {
          openInManager: true,
        },
      },
      rootFolder: null,
      init: vi.fn(),
      setRootFolderId: vi.fn(),
      refresh: vi.fn(),
      createBookmark: vi.fn(),
      updateBookmark: vi.fn(),
      deleteBookmark: vi.fn(),
      deleteFolder: vi.fn(),
      createFolder: vi.fn(),
      moveBookmark: vi.fn(),
    })
  })

  it("renders the organizer title and toolbar actions", () => {
    render(<BookmarkOrganizerSheet />)

    expect(screen.getByText("Bookmark Organizer")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Expand All" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Collapse All" })).toBeTruthy()
  })
})
