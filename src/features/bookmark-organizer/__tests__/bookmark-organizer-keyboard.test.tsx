// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { BookmarkOrganizerTree } from "../bookmark-organizer-tree"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import type { BookmarkNode } from "@/browser"

/**
 * Drives the organizer the way a keyboard user does — real key events into
 * the rendered tree, no direct calls into `@headless-tree/core`. The features
 * that provide this are configuration, not code we wrote, so the only thing
 * worth asserting is what the configuration lets through: which row holds the
 * tab stop, which rows the arrows are allowed to visit, and which drop
 * positions a keyboard drag may propose.
 */

/**
 * `hotkeysCoreFeature` matches on the *set* of keys currently held, and
 * clears that set from a document-level keyup — so a press that is not
 * released stays in the set and blocks every hotkey after it.
 */
function press(element: Element, ...codes: string[]) {
  for (const code of codes) {
    fireEvent.keyDown(element, { code })
  }
  for (const code of codes) {
    fireEvent.keyUp(document, { code })
  }
}

const VAULT: Record<string, BookmarkNode> = {
  "root-1": {
    id: "root-1",
    title: "Bookmarks Bar",
    children: [
      { id: "folder-1", title: "Folder One", parentId: "root-1", children: [] },
      {
        id: "bookmark-1",
        title: "Bookmark One",
        parentId: "root-1",
        url: "https://example.com/one",
      },
      { id: "folder-2", title: "Folder Two", parentId: "root-1", children: [] },
    ],
  },
  "folder-1": {
    id: "folder-1",
    title: "Folder One",
    parentId: "root-1",
    children: [
      {
        id: "bookmark-2",
        title: "Nested Bookmark",
        parentId: "folder-1",
        url: "https://example.com/two",
      },
    ],
  },
  "folder-2": {
    id: "folder-2",
    title: "Folder Two",
    parentId: "root-1",
    children: [],
  },
  "bookmark-1": {
    id: "bookmark-1",
    title: "Bookmark One",
    parentId: "root-1",
    url: "https://example.com/one",
  },
  "bookmark-2": {
    id: "bookmark-2",
    title: "Nested Bookmark",
    parentId: "folder-1",
    url: "https://example.com/two",
  },
}

function mountStore(
  capabilities: { move: boolean; reorder: boolean; setChildOrder: boolean },
  readOnlyIds: string[] = []
) {
  useUIStore.setState({
    settingsOpen: false,
    bookmarkOrganizerOpen: true,
    editingBookmark: null,
    deletingItem: null,
    creatingItem: null,
  })

  useBookmarkStore.setState({
    tree: [{ id: "root-1", title: "Bookmarks Bar", children: [] }],
    rootFolderId: "root-1",
    isLoading: false,
    adapter: {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue([]),
        getSubTree: vi.fn().mockImplementation(async (id: string) => {
          const node = VAULT[id]
          if (!node) return []
          return [
            {
              ...node,
              readOnly: readOnlyIds.includes(node.id) || undefined,
              children: node.children?.map((child) => ({
                ...child,
                readOnly: readOnlyIds.includes(child.id) || undefined,
              })),
            },
          ]
        }),
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
      storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
      favicon: { getUrl: vi.fn(() => ""), isAvailable: vi.fn(() => false) },
      capabilities: { openInManager: false, ...capabilities },
    },
    rootFolder: { id: "root-1", title: "Bookmarks Bar", children: [] },
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
}

function renderTree(showBookmarks = true) {
  return render(
    <BookmarkOrganizerTree
      rootFolderId="root-1"
      showBookmarks={showBookmarks}
      treeRef={{ current: null }}
    />
  )
}

function row(name: string) {
  return screen.getByRole("treeitem", { name })
}

const FULL_ORDERING = { move: true, reorder: true, setChildOrder: false }

afterEach(() => {
  cleanup()
})

describe("BookmarkOrganizerTree keyboard navigation", () => {
  beforeEach(() => {
    mountStore(FULL_ORDERING)
  })

  it("gives the first row the tab stop and moves it with the arrow keys", async () => {
    renderTree()

    await waitFor(() => expect(row("Nested Bookmark")).toBeTruthy())
    expect(row("Folder One").tabIndex).toBe(0)

    press(row("Folder One"), "ArrowDown")

    expect(row("Nested Bookmark").tabIndex).toBe(0)
    expect(row("Folder One").tabIndex).toBe(-1)

    press(row("Nested Bookmark"), "ArrowUp")

    expect(row("Folder One").tabIndex).toBe(0)
  })

  it("collapses and expands the focused folder with left and right", async () => {
    renderTree()

    await waitFor(() => expect(row("Nested Bookmark")).toBeTruthy())
    expect(row("Folder One").getAttribute("aria-expanded")).toBe("true")

    press(row("Folder One"), "ArrowLeft")

    expect(row("Folder One").getAttribute("aria-expanded")).toBe("false")
    expect(
      screen.queryByRole("treeitem", { name: "Nested Bookmark" })
    ).toBeNull()

    press(row("Folder One"), "ArrowRight")

    await waitFor(() => expect(row("Nested Bookmark")).toBeTruthy())
  })

  it("selects the focused row so a keyboard drag has something to carry", async () => {
    renderTree()

    await waitFor(() => expect(row("Nested Bookmark")).toBeTruthy())

    fireEvent.click(row("Bookmark One"))

    expect(row("Bookmark One").getAttribute("aria-selected")).toBe("true")
    expect(row("Folder One").getAttribute("aria-selected")).toBe("false")
  })

  it("steps over the rows Folders Only hides", async () => {
    renderTree(false)

    await waitFor(() => expect(row("Folder Two")).toBeTruthy())
    expect(screen.queryByRole("treeitem", { name: "Bookmark One" })).toBeNull()
    expect(row("Folder One").tabIndex).toBe(0)

    // Two bookmark rows sit between the folders in the flattened tree; without
    // the correction the tab stop would land on one of them and disappear.
    press(row("Folder One"), "ArrowDown")

    expect(row("Folder Two").tabIndex).toBe(0)
    expect(row("Folder One").tabIndex).toBe(-1)
  })
})

describe("BookmarkOrganizerTree keyboard drag", () => {
  function assistiveText(container: HTMLElement) {
    return container.querySelector('[aria-live="assertive"]')?.textContent ?? ""
  }

  function startDragOn(name: string) {
    press(row(name), "ControlLeft", "ShiftLeft", "KeyD")
  }

  it("offers an ordered position when the source can express an order", async () => {
    mountStore(FULL_ORDERING)
    const { container } = renderTree()

    await waitFor(() => expect(row("Nested Bookmark")).toBeTruthy())
    fireEvent.click(row("Bookmark One"))
    startDragOn("Bookmark One")

    // "<index> of <count> in <folder>" is the library's own wording for a drop
    // between two rows, which is exactly the gesture `reorder` pays for.
    expect(assistiveText(container)).toMatch(/\d+ of \d+ in /)
  })

  it("never offers one when the source can only reparent", async () => {
    mountStore({ move: true, reorder: false, setChildOrder: false })
    const { container } = renderTree()

    await waitFor(() => expect(row("Nested Bookmark")).toBeTruthy())
    fireEvent.click(row("Bookmark One"))
    startDragOn("Bookmark One")

    expect(assistiveText(container)).toContain("Dragging Bookmark One")

    // Every position the drag can reach has to be a plain drop *onto* a
    // folder; an ordered one would be a reorder the adapter cannot persist.
    for (let i = 0; i < 4; i++) {
      expect(assistiveText(container)).not.toMatch(/\d+ of \d+ in /)
      press(document.body, "ArrowDown")
    }
  })

  it("refuses to pick up a read-only row", async () => {
    mountStore(FULL_ORDERING, ["bookmark-1"])
    const { container } = renderTree()

    await waitFor(() => expect(row("Nested Bookmark")).toBeTruthy())
    fireEvent.click(row("Bookmark One"))
    startDragOn("Bookmark One")

    expect(assistiveText(container)).not.toContain("Dragging")
  })
})
