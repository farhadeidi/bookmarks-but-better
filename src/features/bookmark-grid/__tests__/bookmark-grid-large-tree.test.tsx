// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { BookmarkNode } from "@/browser"
import { materializeSeed } from "@/dev/engine"
import { getScenario } from "@/dev/scenarios"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkGrid } from "../bookmark-grid"
import { distributeToColumns } from "../card-heights"
import { getVisibleFolders } from "../folder-collection"
import { buildNavigationColumns } from "../grid-navigation"
import { shouldGateCards } from "../lazy-cards-gate"

/**
 * Budgets for the `large-tree` Dev Workbench scenario — 10,000 bookmarks in
 * 300 folders (issue #85) — so the grid cannot quietly get slow again.
 *
 * Wall-clock budgets are an order of magnitude above what the work costs in
 * Chromium (a few milliseconds), so a slow CI machine does not flake them;
 * they only trip on a change in complexity, such as a walk per card.
 */

const ROOT: BookmarkNode = materializeSeed(
  "0",
  "Root",
  "b",
  [],
  [
    {
      id: "1",
      title: "Bookmarks Bar",
      children: getScenario("large-tree").browserTree ?? [],
    },
  ]
)

class InertIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
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
  // Nothing is ever near, so every card but the tab stop's stays a
  // placeholder: the test is about the grid's own work, not card content.
  vi.stubGlobal("IntersectionObserver", InertIntersectionObserver)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** The fastest of a few runs, in milliseconds: the least noisy estimate. */
function fastest(runs: number, work: () => void): number {
  let best = Infinity
  for (let i = 0; i < runs; i++) {
    const start = performance.now()
    work()
    best = Math.min(best, performance.now() - start)
  }
  return best
}

describe("BookmarkGrid with a 10,000-bookmark tree", () => {
  it.each([false, true])(
    "keeps the layout pass within budget (nested folders: %s)",
    (nestedFolders) => {
      let folders: BookmarkNode[] = []
      const elapsed = fastest(5, () => {
        folders = getVisibleFolders({
          displayRoot: ROOT,
          nestedFolders,
          experimentalCardDrag: true,
          folderOrder: [],
        })
        shouldGateCards(ROOT)
        const columns = distributeToColumns(folders, 6, {}, new Map())
        buildNavigationColumns(columns, nestedFolders)
      })

      // Flattened, every folder is a card: the 300 generated plus the bar.
      expect(folders).toHaveLength(nestedFolders ? 1 : 301)
      expect(shouldGateCards(ROOT)).toBe(true)
      expect(elapsed).toBeLessThan(100)
    }
  )

  it("resolves scroll roots per shared ancestor, not per card", () => {
    useBookmarkStore.setState({
      adapter: {
        bookmarks: {} as never,
        storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
        favicon: { getUrl: () => "", isAvailable: () => false },
        capabilities: {
          openInManager: false,
          move: true,
          reorder: true,
          setChildOrder: false,
        },
      },
      tree: [ROOT],
      rootFolder: ROOT,
      isLoading: false,
    })
    usePreferencesStore.setState({
      experimentalCardDrag: false,
      nestedFolders: false,
      folderOrder: [],
      cardLayouts: {},
      maxColumns: 4,
      containerMode: "fluid",
    })
    const getComputedStyle = vi.spyOn(globalThis, "getComputedStyle")

    const start = performance.now()
    const { container } = render(<BookmarkGrid />)
    const elapsed = performance.now() - start

    expect(
      container.querySelectorAll('[data-testid="bookmark-card-placeholder"]')
    ).toHaveLength(300)
    // One walk per column at most. Walking every card's ancestors was over a
    // thousand style reads, each a potential forced style recalculation.
    expect(getComputedStyle.mock.calls.length).toBeLessThan(50)
    // jsdom is far slower than a browser; this only catches a blow-up.
    expect(elapsed).toBeLessThan(5_000)
  })
})
