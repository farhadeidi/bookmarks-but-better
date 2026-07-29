// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
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
          move: true,
          reorder: true,
          setChildOrder: false,
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

  afterEach(() => {
    cleanup()
  })

  it("renders the organizer title and toolbar actions", () => {
    render(<BookmarkOrganizerSheet />)

    expect(screen.getByText("Bookmark Organizer")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Expand All" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Collapse All" })).toBeTruthy()
  })

  it("surfaces a mutation error inline, since a drag has no dialog to report into", () => {
    render(<BookmarkOrganizerSheet />)

    // A failed reorder would otherwise be completely silent: the row just
    // springs back with no explanation.
    act(() => {
      useBookmarkStore.setState({
        mutationError:
          "This folder's order changed elsewhere. Refresh and try again.",
      })
    })

    const alert = screen.getByRole("alert")
    expect(alert.textContent).toBe(
      "This folder's order changed elsewhere. Refresh and try again."
    )
  })

  it("shows no error line when there is nothing to report", () => {
    render(<BookmarkOrganizerSheet />)

    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("clears a stale message when the sheet is closed and reopened", () => {
    render(<BookmarkOrganizerSheet />)

    act(() => {
      useBookmarkStore.setState({ mutationError: "Something went wrong." })
    })
    expect(screen.getByRole("alert")).toBeTruthy()

    act(() => {
      useUIStore.setState({ bookmarkOrganizerOpen: false })
    })
    expect(useBookmarkStore.getState().mutationError).toBeNull()

    act(() => {
      useUIStore.setState({ bookmarkOrganizerOpen: true })
    })
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
