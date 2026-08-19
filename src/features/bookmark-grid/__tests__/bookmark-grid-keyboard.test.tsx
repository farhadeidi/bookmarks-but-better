// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act, cleanup, render, screen } from "@testing-library/react"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"
import { useSearchTypeAhead } from "@/features/search-palette/use-search-type-ahead"
import { BookmarkGrid } from "../bookmark-grid"

/**
 * The dashboard grid as one composite widget: a single tab stop, arrow keys
 * that follow the columns the masonry actually drew, and a focus that has to
 * outlive the wholesale tree replacement every mutation ends in.
 *
 * Four equal cards over two columns put the second folder in the *second*
 * column, so "the card below alpha" is gamma and "the card to the right of
 * alpha" is beta — the two directions a model built on the folder list rather
 * than the layout would get the wrong way round.
 */

function folder(id: string, bookmarks: string[]): BookmarkNode {
  return {
    id,
    title: id,
    children: bookmarks.map((title) => ({
      id: title,
      title,
      url: `https://${title}.example`,
    })),
  }
}

function treeWith(folders: BookmarkNode[]): BookmarkNode[] {
  return [{ id: "root", title: "Root", children: folders }]
}

const FOLDERS = [
  folder("alpha", ["a one", "a two"]),
  folder("beta", ["b one", "b two"]),
  folder("gamma", ["g one", "g two"]),
  folder("delta", ["d one", "d two"]),
]

type Capabilities = BrowserAdapter["capabilities"]

const EXTENSION_CAPABILITIES: Capabilities = {
  openInManager: true,
  move: true,
  reorder: true,
  setChildOrder: false,
}

const DAEMON_CAPABILITIES: Capabilities = {
  openInManager: false,
  move: true,
  reorder: false,
  setChildOrder: true,
}

function adapterWith(capabilities: Capabilities): BrowserAdapter {
  return {
    bookmarks: { setChildOrder: vi.fn(), openInManager: vi.fn() },
    storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    favicon: { getUrl: () => "", isAvailable: () => false },
    capabilities,
  } as unknown as BrowserAdapter
}

function TypeAheadGrid() {
  useSearchTypeAhead()
  return <BookmarkGrid />
}

function mount(
  options: {
    capabilities?: Capabilities
    folders?: BookmarkNode[]
    withTypeAhead?: boolean
  } = {}
) {
  const tree = treeWith(options.folders ?? FOLDERS)
  useBookmarkStore.setState({
    adapter: adapterWith(options.capabilities ?? EXTENSION_CAPABILITIES),
    tree,
    rootFolder: tree[0],
    isLoading: false,
    moveBookmark: vi.fn().mockResolvedValue(true),
    setChildOrder: vi.fn().mockResolvedValue(true),
  })
  usePreferencesStore.setState({
    experimentalCardDrag: false,
    nestedFolders: true,
    folderOrder: [],
    cardLayouts: {},
    // Two columns is what makes the layout order and the folder-list order
    // disagree; the jsdom viewport would otherwise ask for four.
    maxColumns: 2,
    containerMode: "fluid",
  })
  render(options.withTypeAhead ? <TypeAheadGrid /> : <BookmarkGrid />)
}

function bookmark(title: string): HTMLElement {
  return screen.getByRole("link", { name: new RegExp(`^${title}`) })
}

function heading(title: string): HTMLElement {
  return screen.getByRole("heading", { name: title })
}

function press(key: string, modifier?: "alt") {
  const element = document.activeElement as HTMLElement
  act(() => {
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        altKey: modifier === "alt",
        bubbles: true,
        cancelable: true,
      })
    )
  })
}

describe("BookmarkGrid keyboard navigation", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })
    )
    useUIStore.setState({ searchPalette: null })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
    useUIStore.setState({ searchPalette: null })
  })

  it("offers exactly one tab stop for the whole grid", () => {
    mount()

    const tabbable = document.querySelectorAll(
      "a[tabindex='0'], h3[tabindex='0']"
    )
    expect(tabbable).toHaveLength(1)
    expect(tabbable[0]).toBe(heading("alpha"))
  })

  it("moves down within a card and on across the card boundary below it", () => {
    mount()
    act(() => bookmark("a one").focus())

    press("ArrowDown")
    expect(document.activeElement).toBe(bookmark("a two"))

    // gamma is the card underneath alpha; beta is the next folder in the
    // list, and it is in the other column.
    press("ArrowDown")
    expect(document.activeElement).toBe(heading("gamma"))
  })

  it("moves between columns on left and right", () => {
    mount()
    act(() => heading("alpha").focus())

    press("ArrowRight")
    expect(document.activeElement).toBe(heading("beta"))

    press("ArrowLeft")
    expect(document.activeElement).toBe(heading("alpha"))
  })

  it("takes Home and End to the ends of the column", () => {
    mount()
    act(() => bookmark("a two").focus())

    press("End")
    expect(document.activeElement).toBe(bookmark("g two"))

    press("Home")
    expect(document.activeElement).toBe(heading("alpha"))
  })

  it("hands the single tab stop to whatever the arrows moved to", () => {
    mount()
    act(() => bookmark("a one").focus())
    press("ArrowDown")

    expect(bookmark("a two")).toHaveProperty("tabIndex", 0)
    expect(bookmark("a one")).toHaveProperty("tabIndex", -1)
  })

  it("leaves Enter to the anchor, so a bookmark opens the way a link does", () => {
    mount()
    act(() => bookmark("a one").focus())

    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      document.activeElement!.dispatchEvent(event)
    })

    expect(event.defaultPrevented).toBe(false)
  })

  it("still lets a typed character reach the search palette", () => {
    mount({ withTypeAhead: true })
    act(() => bookmark("a one").focus())

    act(() => {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "g",
          bubbles: true,
          cancelable: true,
        })
      )
    })

    expect(useUIStore.getState().searchPalette?.seedQuery).toBe("g")
  })

  it("keeps the arrows out of the palette's way", () => {
    mount({ withTypeAhead: true })
    act(() => bookmark("a one").focus())

    press("ArrowDown")
    press("ArrowDown", "alt")

    expect(useUIStore.getState().searchPalette).toBeNull()
  })
})

describe("BookmarkGrid focus after a mutation", () => {
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

  it("lands on whatever took the deleted bookmark's place", () => {
    mount()
    act(() => bookmark("a one").focus())

    const withoutFirst = [folder("alpha", ["a two"]), ...FOLDERS.slice(1)]
    const tree = treeWith(withoutFirst)
    act(() => {
      useBookmarkStore.setState({ tree, rootFolder: tree[0] })
    })

    expect(document.activeElement).toBe(bookmark("a two"))
  })

  it("holds the visual position when the whole card goes and the masonry re-deals", () => {
    mount()
    act(() => bookmark("g one").focus())

    const withoutGamma = FOLDERS.filter((f) => f.id !== "gamma")
    const tree = treeWith(withoutGamma)
    act(() => {
      useBookmarkStore.setState({ tree, rootFolder: tree[0] })
    })

    // Three cards over two columns puts delta where gamma was, so the fifth
    // stop down the first column is delta's first bookmark — the place on
    // screen the focus was already looking at, rather than the document.
    expect(document.activeElement).toBe(bookmark("d one"))
  })

  it("does not reach out and take back a focus the user moved away", () => {
    mount()
    act(() => bookmark("a one").focus())

    const outside = document.createElement("button")
    document.body.appendChild(outside)
    act(() => outside.focus())

    const withoutFirst = [folder("alpha", ["a two"]), ...FOLDERS.slice(1)]
    const tree = treeWith(withoutFirst)
    act(() => {
      useBookmarkStore.setState({ tree, rootFolder: tree[0] })
    })

    expect(document.activeElement).toBe(outside)
    // The tab stop still moved on, so Tab reaches the grid at a sane place.
    expect(bookmark("a two")).toHaveProperty("tabIndex", 0)
    outside.remove()
  })
})

describe("BookmarkGrid keyboard reordering", () => {
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

  it("positions through move() when the adapter can reorder", () => {
    mount({ capabilities: EXTENSION_CAPABILITIES })
    act(() => bookmark("a one").focus())

    press("ArrowDown", "alt")

    const { moveBookmark, setChildOrder } = useBookmarkStore.getState()
    expect(moveBookmark).toHaveBeenCalledWith("a one", {
      parentId: "alpha",
      index: 1,
    })
    expect(setChildOrder).not.toHaveBeenCalled()
  })

  it("writes a whole-folder order in daemon mode", () => {
    mount({ capabilities: DAEMON_CAPABILITIES })
    act(() => bookmark("a one").focus())

    press("ArrowDown", "alt")

    const { moveBookmark, setChildOrder } = useBookmarkStore.getState()
    expect(setChildOrder).toHaveBeenCalledWith("alpha", ["a two", "a one"])
    expect(moveBookmark).not.toHaveBeenCalled()
  })

  it("writes nothing when the adapter can express no order at all", () => {
    mount({
      capabilities: {
        openInManager: false,
        move: true,
        reorder: false,
        setChildOrder: false,
      },
    })
    act(() => bookmark("a one").focus())

    press("ArrowDown", "alt")

    const { moveBookmark, setChildOrder } = useBookmarkStore.getState()
    expect(moveBookmark).not.toHaveBeenCalled()
    expect(setChildOrder).not.toHaveBeenCalled()
  })

  it("writes nothing in a folder whose child order is frozen", () => {
    const frozen = {
      ...folder("alpha", ["a one", "a two"]),
      orderReadOnly: true,
    }
    mount({
      capabilities: DAEMON_CAPABILITIES,
      folders: [frozen, ...FOLDERS.slice(1)],
    })
    act(() => bookmark("a one").focus())

    press("ArrowDown", "alt")

    expect(useBookmarkStore.getState().setChildOrder).not.toHaveBeenCalled()
  })

  it("leaves folder cards alone: their order is a client-local preference", () => {
    mount({ capabilities: EXTENSION_CAPABILITIES })
    act(() => heading("alpha").focus())

    press("ArrowDown", "alt")

    expect(useBookmarkStore.getState().moveBookmark).not.toHaveBeenCalled()
  })
})
