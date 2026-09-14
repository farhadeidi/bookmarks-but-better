// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { RootFolderControl } from "./root-folder-control"

class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const VAULT: BookmarkNode[] = [
  {
    id: "vault-root",
    title: "Bookmarks",
    children: [{ id: "work", title: "Work", children: [] }],
  },
]

/** A tree with no selectable folder and nowhere real to create one under. */
const EMPTY_TREE: BookmarkNode[] = [{ id: "0", title: "", children: [] }]

function stubAdapter(): BrowserAdapter {
  return {
    kind: "browser",
    capabilities: { rootIsCreatable: false },
    bookmarks: {} as BrowserAdapter["bookmarks"],
    storage: { get: vi.fn(), set: vi.fn() },
  } as unknown as BrowserAdapter
}

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  vi.stubGlobal("ResizeObserver", StubResizeObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  useBookmarkStore.setState({
    tree: [],
    rootFolderId: null,
    rootFolder: null,
    adapter: null,
  })
  useUIStore.setState({ bookmarkOrganizerOpen: false })
})

describe("RootFolderControl", () => {
  it('shows "All bookmarks" at the root', () => {
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: null })

    render(<RootFolderControl />)

    expect(screen.getByRole("button", { name: "All bookmarks" })).not.toBeNull()
  })

  it("shows the folder name, not the full path, when narrowed", () => {
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: "work" })

    render(<RootFolderControl />)

    expect(screen.getByRole("button", { name: "Work" })).not.toBeNull()
  })

  it("is hidden when the source offers no folder choice", () => {
    useBookmarkStore.setState({
      tree: EMPTY_TREE,
      rootFolderId: null,
      adapter: stubAdapter(),
    })

    const { container } = render(<RootFolderControl />)

    expect(container.innerHTML).toBe("")
  })

  it("opens the picker from the chevron and lists the same paths RootFolderSelect shows", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: null })

    render(<RootFolderControl />)

    await user.click(screen.getByRole("button", { name: "All bookmarks" }))

    expect(
      await screen.findByRole("menuitem", { name: "Bookmarks > Work" })
    ).not.toBeNull()
  })

  it("choosing a folder updates the store", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: null })

    render(<RootFolderControl />)

    await user.click(screen.getByRole("button", { name: "All bookmarks" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Bookmarks > Work" })
    )

    expect(useBookmarkStore.getState().rootFolderId).toBe("work")
  })

  it("opens the bookmark tree from the picker's footer", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: null })

    render(<RootFolderControl />)

    await user.click(screen.getByRole("button", { name: "All bookmarks" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Edit bookmark tree" })
    )

    expect(useUIStore.getState().bookmarkOrganizerOpen).toBe(true)
    // Opening the tree leaves the grid's root folder alone.
    expect(useBookmarkStore.getState().rootFolderId).toBeNull()
  })

  it("returns to all bookmarks from the picker's first item", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: "work" })

    render(<RootFolderControl />)

    await user.click(screen.getByRole("button", { name: "Work" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "All bookmarks" })
    )

    expect(useBookmarkStore.getState().rootFolderId).toBeNull()
  })
})
