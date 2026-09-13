// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render } from "@testing-library/react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkGrid } from "../bookmark-grid"

/**
 * The grid mounts a folder card only near the viewport (issue #75). These
 * cases pin the contract: a far card is a placeholder of its estimated —
 * later its last real — height, the viewport brings it in and takes it
 * out again, and the keyboard's tab stop pins its card open regardless.
 */

class StubIntersectionObserver {
  static instances: StubIntersectionObserver[] = []

  targets = new Set<Element>()
  callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    StubIntersectionObserver.instances.push(this)
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

  report(near: Map<Element, { isIntersecting: boolean; height: number }>) {
    const entries = Array.from(this.targets)
      .filter((target) => near.has(target))
      .map(
        (target) =>
          ({
            target,
            isIntersecting: near.get(target)!.isIntersecting,
            boundingClientRect: { height: near.get(target)!.height },
          }) as unknown as IntersectionObserverEntry
      )
    if (entries.length > 0) {
      this.callback(entries, this as unknown as IntersectionObserver)
    }
  }
}

const TREE = [
  {
    id: "root",
    title: "Root",
    children: ["one", "two"].map((id) => ({
      id,
      title: id,
      children: [
        { id: `${id}-b`, title: `${id} bookmark`, url: "https://e.example" },
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
    maxColumns: 1,
    containerMode: "fluid",
  })
  return render(<BookmarkGrid />)
}

/** The lazy wrappers the grid asked the observer to watch, by folder title. */
function wrappersByTitle(container: HTMLElement): Map<string, Element> {
  const wrappers = new Map<string, Element>()
  for (const heading of container.querySelectorAll("h3")) {
    // Placeholder or card, the wrapper is the column's direct child.
    const wrapper = heading.closest(".grid > div > div")
    if (wrapper) wrappers.set(heading.textContent ?? "", wrapper)
  }
  return wrappers
}

function report(
  container: HTMLElement,
  near: Record<string, { isIntersecting: boolean; height: number }>
) {
  const wrappers = wrappersByTitle(container)
  const byElement = new Map<
    Element,
    { isIntersecting: boolean; height: number }
  >()
  for (const [title, entry] of Object.entries(near)) {
    const element = wrappers.get(title)
    if (element) byElement.set(element, entry)
  }
  act(() => {
    for (const instance of StubIntersectionObserver.instances) {
      instance.report(byElement)
    }
  })
}

function mountedTitles(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid="bookmark-card"] > div > h3')
  ).map((h) => h.textContent ?? "")
}

function placeholderTitles(container: HTMLElement): string[] {
  return Array.from(
    container.querySelectorAll('[data-testid="bookmark-card-placeholder"] h3')
  ).map((h) => h.textContent ?? "")
}

describe("LazyCard", () => {
  beforeEach(() => {
    StubIntersectionObserver.instances = []
    vi.stubGlobal("IntersectionObserver", StubIntersectionObserver)
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
  })

  it("starts a card as a placeholder of its estimated height, except the one holding the initial tab stop", () => {
    const { container } = mount()

    expect(mountedTitles(container)).toEqual(["one"])
    expect(placeholderTitles(container)).toEqual(["two"])
    const placeholder = container.querySelector<HTMLElement>(
      '[data-testid="bookmark-card-placeholder"]'
    )
    // One list row on top of the card chrome; see `estimateCardHeight`.
    expect(placeholder?.style.minHeight).toBe("96px")
  })

  it("mounts a card the viewport approaches and tears it down when it leaves, keeping its last height", () => {
    const { container } = mount()

    report(container, { two: { isIntersecting: true, height: 96 } })
    expect(mountedTitles(container)).toEqual(["one", "two"])
    expect(placeholderTitles(container)).toEqual([])

    report(container, { two: { isIntersecting: false, height: 240 } })
    expect(mountedTitles(container)).toEqual(["one"])
    const placeholder = container.querySelector<HTMLElement>(
      '[data-testid="bookmark-card-placeholder"]'
    )
    expect(placeholder?.style.minHeight).toBe("240px")
  })

  it("keeps the card holding the grid's tab stop mounted wherever the viewport is", () => {
    const { container } = mount()

    report(container, {
      one: { isIntersecting: true, height: 96 },
      two: { isIntersecting: true, height: 96 },
    })
    const bookmark = container.querySelector<HTMLElement>(
      'a[href="https://e.example"]'
    )!
    act(() => bookmark.focus())
    expect(bookmark.tabIndex).toBe(0)

    report(container, {
      one: { isIntersecting: false, height: 96 },
      two: { isIntersecting: false, height: 96 },
    })
    expect(mountedTitles(container)).toEqual(["one"])
    expect(placeholderTitles(container)).toEqual(["two"])
  })
})
