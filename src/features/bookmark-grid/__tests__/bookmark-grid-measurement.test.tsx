// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkGrid } from "../bookmark-grid"

/**
 * The grid balances columns from measured card heights, which is a loop —
 * measure, re-balance, measure again. These cases pin the rules that stop it
 * spinning: a change under the threshold is ignored, and within one set of
 * distribution inputs a card is only ever allowed to grow.
 */

class StubResizeObserver {
  static instances: StubResizeObserver[] = []

  targets = new Set<Element>()
  callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    StubResizeObserver.instances.push(this)
  }

  observe(target: Element) {
    this.targets.add(target)
  }

  unobserve(target: Element) {
    this.targets.delete(target)
  }

  disconnect() {
    this.targets.clear()
  }

  report(heights: Map<Element, number>) {
    const entries = Array.from(this.targets)
      .filter((target) => heights.has(target))
      .map(
        (target) =>
          ({
            target,
            borderBoxSize: [{ blockSize: heights.get(target), inlineSize: 0 }],
            contentRect: { height: heights.get(target) },
          }) as unknown as ResizeObserverEntry
      )

    if (entries.length > 0) {
      this.callback(entries, this as unknown as ResizeObserver)
    }
  }
}

const TREE = [
  {
    id: "root",
    title: "Root",
    children: ["one", "two", "three"].map((id) => ({
      id,
      title: id,
      children: [
        { id: `${id}-b`, title: "Bookmark", url: "https://e.example" },
      ],
    })),
  },
]

function mount() {
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
    tree: TREE,
    rootFolder: TREE[0],
    isLoading: false,
  })
  usePreferencesStore.setState({
    experimentalCardDrag: false,
    nestedFolders: true,
    folderOrder: [],
    cardLayouts: {},
    maxColumns: 2,
    containerMode: "fluid",
  })
  return render(<BookmarkGrid />)
}

/** The folder titles in each rendered column, in visual order. */
function columns(container: HTMLElement): string[][] {
  const grid = container.querySelector(".grid")
  return Array.from(grid?.children ?? []).map((column) =>
    Array.from(column.querySelectorAll("h3")).map((h) => h.textContent ?? "")
  )
}

/** Cards, keyed by the element the grid asked the observer to watch. */
function cardsByTitle(container: HTMLElement): Map<string, Element> {
  const cards = new Map<string, Element>()
  for (const card of container.querySelectorAll(
    '[data-testid="bookmark-card"]'
  )) {
    const title = card.querySelector("h3")?.textContent ?? ""
    if (card.parentElement) cards.set(title, card.parentElement)
  }
  return cards
}

function report(container: HTMLElement, heights: Record<string, number>) {
  const cards = cardsByTitle(container)
  const byElement = new Map<Element, number>()
  for (const [title, height] of Object.entries(heights)) {
    const element = cards.get(title)
    if (element) byElement.set(element, height)
  }

  act(() => {
    for (const instance of StubResizeObserver.instances) {
      instance.report(byElement)
    }
  })
}

beforeEach(() => {
  StubResizeObserver.instances = []
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
  vi.clearAllMocks()
})

describe("BookmarkGrid card measurement", () => {
  it("balances on estimates until a card has been measured", () => {
    const { container } = mount()

    // Equal estimates alternate, so the third card returns to the first column.
    expect(columns(container)).toEqual([["one", "three"], ["two"]])
  })

  it("re-balances once a measured card turns out to be taller than its estimate", () => {
    const { container } = mount()

    report(container, { one: 400, two: 100, three: 100 })

    expect(columns(container)).toEqual([["one"], ["two", "three"]])
  })

  it("ignores a change smaller than the threshold", () => {
    const { container } = mount()
    // The two columns are 2px apart, so a card taking 4px of sub-pixel churn at
    // face value would be enough to send the third card the other way.
    report(container, { one: 100, two: 102, three: 100 })
    expect(columns(container)).toEqual([["one", "three"], ["two"]])

    report(container, { one: 104 })

    expect(columns(container)).toEqual([["one", "three"], ["two"]])
  })

  it("does not let a measured card shrink again under the same inputs", () => {
    const { container } = mount()
    report(container, { one: 400, two: 100, three: 100 })

    // A card reporting a smaller height after it has already been placed is how
    // the loop would oscillate: the re-balance would make it tall again.
    report(container, { one: 100 })

    expect(columns(container)).toEqual([["one"], ["two", "three"]])
  })

  it("re-balances again when a measured card grows past the threshold", () => {
    const { container } = mount()
    report(container, { one: 400, two: 100, three: 100 })

    report(container, { two: 500 })

    expect(columns(container)).toEqual([["one", "three"], ["two"]])
  })

  it("takes a fresh measurement in either direction once the inputs change", () => {
    const { container } = mount()
    report(container, { one: 400, two: 100, three: 100 })

    // Switching a card's layout is a new generation, so the card is allowed to
    // report the shorter height that layout actually produces.
    act(() => {
      usePreferencesStore.setState({ cardLayouts: { one: "grid" } })
    })
    report(container, { one: 100, two: 100, three: 100 })

    expect(columns(container)).toEqual([["one", "three"], ["two"]])
  })
})
