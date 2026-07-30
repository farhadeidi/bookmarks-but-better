// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import type { BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkGrid } from "../bookmark-grid"

/**
 * Regression cover for the daemon main grid's folder-card affordance.
 *
 * The drag handle used to be gated on `capabilities.reorder` alone, so in
 * daemon mode — `reorder: false`, `setChildOrder: true` — the cards rendered
 * with no handle at all and the ordering preference could never be reached.
 * Card order stays a client-local preference either way; the capability only
 * decides whether the affordance is offered.
 */

const TREE = [
  {
    id: "root",
    title: "Root",
    children: [
      {
        id: "work",
        title: "Work",
        children: [{ id: "b1", title: "One", url: "https://one.example" }],
      },
      {
        id: "play",
        title: "Play",
        children: [{ id: "b9", title: "Nine", url: "https://nine.example" }],
      },
    ],
  },
]

type Capabilities = BrowserAdapter["capabilities"]

function adapterWith(capabilities: Capabilities): BrowserAdapter {
  return {
    bookmarks: { setChildOrder: vi.fn(), openInManager: vi.fn() },
    storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    favicon: { getUrl: () => "", isAvailable: () => false },
    capabilities,
  } as unknown as BrowserAdapter
}

function mount(capabilities: Capabilities) {
  useBookmarkStore.setState({
    adapter: adapterWith(capabilities),
    tree: TREE,
    rootFolder: TREE[0],
    isLoading: false,
  })
  usePreferencesStore.setState({
    experimentalCardDrag: true,
    nestedFolders: true,
    folderOrder: [],
    cardLayouts: {},
    maxColumns: 4,
    containerMode: "fluid",
  })
  render(<BookmarkGrid />)
}

describe("BookmarkGrid folder-card drag affordance", () => {
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
    vi.clearAllMocks()
  })

  it("offers drag handles in daemon mode (reorder false, setChildOrder true)", () => {
    mount({
      openInManager: false,
      move: true,
      reorder: false,
      setChildOrder: true,
    })

    expect(screen.getAllByLabelText("Drag to reorder folder")).toHaveLength(2)
  })

  it("offers drag handles in extension mode (reorder true)", () => {
    mount({
      openInManager: true,
      move: true,
      reorder: true,
      setChildOrder: false,
    })

    expect(screen.getAllByLabelText("Drag to reorder folder")).toHaveLength(2)
  })

  it("offers none when the adapter can express no order at all", () => {
    mount({
      openInManager: false,
      move: true,
      reorder: false,
      setChildOrder: false,
    })

    expect(screen.queryAllByLabelText("Drag to reorder folder")).toHaveLength(0)
  })
})
