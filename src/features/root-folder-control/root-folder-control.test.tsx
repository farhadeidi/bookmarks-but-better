// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
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
})

describe("RootFolderControl", () => {
  it("shows the current root name", () => {
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: "work" })

    render(<RootFolderControl />)

    expect(screen.getByRole("combobox").textContent).toBe("Bookmarks > Work")
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

  it("choosing a folder updates the store", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: null })

    render(<RootFolderControl />)

    await user.click(screen.getByRole("combobox"))
    await user.click(
      await screen.findByRole("option", { name: "Bookmarks > Work" })
    )

    expect(useBookmarkStore.getState().rootFolderId).toBe("work")
  })

  it("resets to all bookmarks with one click", async () => {
    const user = userEvent.setup()
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: "work" })

    render(<RootFolderControl />)

    await user.click(screen.getByRole("button", { name: "Show all bookmarks" }))

    expect(useBookmarkStore.getState().rootFolderId).toBeNull()
  })

  it("has no reset action when already showing all bookmarks", () => {
    useBookmarkStore.setState({ tree: VAULT, rootFolderId: null })

    render(<RootFolderControl />)

    expect(
      screen.queryByRole("button", { name: "Show all bookmarks" })
    ).toBeNull()
  })
})
