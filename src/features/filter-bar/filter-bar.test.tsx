// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useSourceStore, resetSourceSession } from "@/stores/source-store"
import { emptySourceConfig } from "@/sources/config"
import { FilterBar } from "./filter-bar"

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
  resetSourceSession()
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

describe("FilterBar", () => {
  it("renders the source switcher and the root-folder chip inside one container row", () => {
    useSourceStore.setState({
      config: {
        ...emptySourceConfig(),
        sources: {
          browser: { enabled: true },
          standalone: { enabled: true, legacy: true },
        },
        activeSourceId: "browser",
      },
      activeSourceId: "browser",
    })
    useBookmarkStore.setState({
      tree: VAULT,
      rootFolderId: null,
      adapter: stubAdapter(),
    })

    const { container } = render(<FilterBar />)

    const switcher = screen.getByRole("button", { name: "Bookmark source" })
    const folder = screen.getByRole("button", { name: /All bookmarks/ })
    // One container wraps the row; both controls are within it rather than
    // in separate top-level rows.
    const row = container.firstElementChild
    expect(row?.contains(switcher)).toBe(true)
    expect(row?.contains(folder)).toBe(true)
  })

  it("still left-aligns the folder control alone when there is only one source", () => {
    useSourceStore.setState({
      config: {
        ...emptySourceConfig(),
        sources: { browser: { enabled: true } },
        activeSourceId: "browser",
      },
      activeSourceId: "browser",
    })
    useBookmarkStore.setState({
      tree: VAULT,
      rootFolderId: null,
      adapter: stubAdapter(),
    })

    render(<FilterBar />)

    expect(screen.queryByRole("button", { name: "Bookmark source" })).toBeNull()
    expect(screen.getByRole("button", { name: "All bookmarks" })).not.toBeNull()
  })
})
