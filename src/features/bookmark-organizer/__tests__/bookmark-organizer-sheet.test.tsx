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

  it("disables the header New menu when no root folder is selected", () => {
    render(<BookmarkOrganizerSheet />)

    const newButton = screen.getByRole("button", { name: "New" })
    expect(newButton.hasAttribute("disabled")).toBe(true)
  })

  it("enables the header New menu once a root folder is selected", () => {
    useBookmarkStore.setState({
      // The folder has to actually be in the tree: a saved id that no longer
      // resolves is treated as absent, so that writes never target a folder
      // that was deleted elsewhere.
      tree: [
        {
          id: "0",
          title: "",
          children: [{ id: "root-1", title: "Root", children: [] }],
        },
      ],
      rootFolderId: "root-1",
    })
    render(<BookmarkOrganizerSheet />)

    const newButton = screen.getByRole("button", { name: "New" })
    expect(newButton.hasAttribute("disabled")).toBe(false)
  })

  it("disables the header New menu when the saved root folder no longer exists", () => {
    useBookmarkStore.setState({ tree: [], rootFolderId: "deleted-folder" })
    render(<BookmarkOrganizerSheet />)

    const newButton = screen.getByRole("button", { name: "New" })
    expect(newButton.hasAttribute("disabled")).toBe(true)
  })

  it("enables the header New menu with no root folder selected when the adapter allows creating at the vault root (daemon, standalone)", () => {
    useBookmarkStore.setState((state) => ({
      tree: [{ id: "vault-root", title: "Vault", children: [] }],
      adapter: state.adapter && {
        ...state.adapter,
        capabilities: { ...state.adapter.capabilities, rootIsCreatable: true },
      },
    }))
    render(<BookmarkOrganizerSheet />)

    const newButton = screen.getByRole("button", { name: "New" })
    expect(newButton.hasAttribute("disabled")).toBe(false)
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
