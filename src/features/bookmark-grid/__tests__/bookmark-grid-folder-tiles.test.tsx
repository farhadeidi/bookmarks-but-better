// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkGrid } from "../bookmark-grid"

/**
 * Folder tiles (#72): a card lists each subfolder as one tile instead of its
 * contents, opening a tile makes the grid draw from that folder, and a
 * breadcrumb leads back out — without ever touching the saved Root folder.
 */

function link(title: string): BookmarkNode {
  return { id: title, title, url: `https://${title.replace(" ", "-")}.example` }
}

const TREE: BookmarkNode[] = [
  {
    id: "root",
    title: "",
    children: [
      {
        id: "alpha",
        title: "alpha",
        children: [
          link("a one"),
          {
            id: "inner",
            title: "inner",
            children: [
              link("i one"),
              { id: "deeper", title: "deeper", children: [link("d one")] },
            ],
          },
          { id: "hollow", title: "hollow", children: [] },
        ],
      },
    ],
  },
]

function mount(
  options: { folderTiles?: boolean; browsedFolderId?: string | null } = {}
) {
  useBookmarkStore.setState({
    adapter: {
      bookmarks: {},
      storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      favicon: { getUrl: () => "", isAvailable: () => false },
      capabilities: {
        openInManager: false,
        move: true,
        reorder: true,
        setChildOrder: false,
      },
    } as unknown as BrowserAdapter,
    tree: TREE,
    rootFolderId: null,
    rootFolder: null,
    browsedFolderId: options.browsedFolderId ?? null,
    isLoading: false,
  })
  usePreferencesStore.setState({
    experimentalCardDrag: false,
    // On underneath, so a test can tell tiles winning from nesting.
    nestedFolders: true,
    folderTiles: options.folderTiles ?? true,
    folderOrder: [],
    cardLayouts: {},
    maxColumns: 2,
    containerMode: "fluid",
  })
  render(<BookmarkGrid />)
}

function breadcrumb(): HTMLElement | null {
  return screen.queryByRole("navigation", { name: "breadcrumb" })
}

describe("BookmarkGrid folder tiles", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    useBookmarkStore.setState({ browsedFolderId: null })
  })

  it("lists each subfolder as a tile with its bookmark count, not its contents", () => {
    mount()

    // Everything below the folder counts, including a folder inside it.
    expect(
      screen.getByRole("button", { name: "inner, 2 bookmarks" })
    ).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "hollow, 0 bookmarks" })
    ).not.toBeNull()
    expect(screen.queryByRole("link", { name: /^i one/ })).toBeNull()
    expect(screen.queryByRole("heading", { name: "inner" })).toBeNull()
    expect(breadcrumb()).toBeNull()
  })

  it("opens the folder a tile names and leads back out through the breadcrumb", () => {
    mount()

    fireEvent.click(screen.getByRole("button", { name: "inner, 2 bookmarks" }))

    // The opened folder draws like a root: its own bookmarks in a card named
    // after it, its subfolders as cards of their own.
    expect(screen.getByRole("heading", { name: "inner" })).not.toBeNull()
    expect(screen.getByRole("link", { name: /^i one/ })).not.toBeNull()
    expect(screen.getByRole("heading", { name: "deeper" })).not.toBeNull()
    expect(screen.queryByRole("heading", { name: "alpha" })).toBeNull()
    // The saved Root folder is not what moved.
    expect(useBookmarkStore.getState().rootFolderId).toBeNull()

    fireEvent.click(
      within(breadcrumb()!).getByRole("button", { name: "All bookmarks" })
    )

    expect(screen.getByRole("heading", { name: "alpha" })).not.toBeNull()
    expect(useBookmarkStore.getState().browsedFolderId).toBeNull()
    expect(breadcrumb()).toBeNull()
  })

  it("steps back to any folder on the way down", () => {
    mount({ browsedFolderId: "deeper" })

    const trail = within(breadcrumb()!)
    expect(trail.getByRole("link", { name: "deeper" })).not.toBeNull()

    fireEvent.click(trail.getByRole("button", { name: "inner" }))

    expect(useBookmarkStore.getState().browsedFolderId).toBe("inner")
  })

  it("keeps the way back when the opened folder is empty", () => {
    mount()

    fireEvent.click(screen.getByRole("button", { name: "hollow, 0 bookmarks" }))

    expect(
      screen.getByRole("heading", { name: "This folder is empty" })
    ).not.toBeNull()
    expect(
      within(breadcrumb()!).getByRole("button", { name: "All bookmarks" })
    ).not.toBeNull()
  })

  it("makes a tile a stop in the grid's roving order", () => {
    mount()

    const row = screen.getByRole("link", { name: /^a one/ })
    act(() => row.focus())
    act(() => {
      row.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          bubbles: true,
          cancelable: true,
        })
      )
    })

    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "inner, 2 bookmarks" })
    )
  })

  it("draws from the root in the other displays, whatever folder was opened", () => {
    mount({ folderTiles: false, browsedFolderId: "inner" })

    expect(screen.getByRole("heading", { name: "alpha" })).not.toBeNull()
    expect(screen.getByRole("link", { name: /^i one/ })).not.toBeNull()
    expect(breadcrumb()).toBeNull()
  })

  it("falls back to the root when the opened folder is gone", () => {
    mount({ browsedFolderId: "deleted" })

    expect(screen.getByRole("heading", { name: "alpha" })).not.toBeNull()
    expect(breadcrumb()).toBeNull()
  })

  it("starts back at the top when another Root folder is chosen", () => {
    mount({ browsedFolderId: "inner" })

    act(() => useBookmarkStore.getState().setRootFolderId("alpha"))

    expect(useBookmarkStore.getState().browsedFolderId).toBeNull()
  })
})
