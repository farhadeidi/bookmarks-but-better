// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import type { BookmarkNode } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkOrganizerSheet } from "../bookmark-organizer-sheet"

/**
 * Reveal is the search palette's answer to a hit the dashboard is not
 * showing, so what matters is that the organizer reaches items it would
 * normally hide: a different branch than the pinned root, and a bookmark
 * while "Folders Only" is on.
 */

const STORE_TREE: BookmarkNode[] = [
  {
    id: "vault",
    title: "Vault",
    children: [
      {
        id: "work",
        title: "Work",
        parentId: "vault",
        children: [
          {
            id: "deep",
            title: "Deep",
            parentId: "work",
            children: [
              {
                id: "target",
                title: "Target Bookmark",
                parentId: "deep",
                url: "https://example.com/target",
              },
            ],
          },
        ],
      },
      { id: "other", title: "Other", parentId: "vault", children: [] },
    ],
  },
]

function nodesById(
  nodes: BookmarkNode[],
  into: Map<string, BookmarkNode> = new Map()
): Map<string, BookmarkNode> {
  for (const node of nodes) {
    into.set(node.id, node)
    if (node.children) nodesById(node.children, into)
  }
  return into
}

const BY_ID = nodesById(STORE_TREE)

function mountStore(rootFolderId: string | null) {
  const rootFolder = rootFolderId ? (BY_ID.get(rootFolderId) ?? null) : null

  useUIStore.setState({
    settingsOpen: false,
    bookmarkOrganizerOpen: true,
    organizerRevealId: null,
    editingBookmark: null,
    deletingItem: null,
    creatingItem: null,
  })

  useBookmarkStore.setState({
    tree: STORE_TREE,
    rootFolderId,
    rootFolder,
    isLoading: false,
    adapter: {
      bookmarks: {
        getTree: vi.fn().mockResolvedValue(STORE_TREE),
        getSubTree: vi.fn().mockImplementation(async (id: string) => {
          const node = BY_ID.get(id)
          return node ? [node] : []
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
      capabilities: {
        openInManager: false,
        move: true,
        reorder: false,
        setChildOrder: false,
        rootIsCreatable: true,
      },
    },
  })
}

describe("Bookmark Organizer reveal", () => {
  beforeEach(() => {
    usePreferencesStore.setState({ isFoldersOnlyEnabledInTreeEditor: true })
  })

  afterEach(() => {
    cleanup()
    useUIStore.setState({ organizerRevealId: null })
  })

  it("expands its way down to the revealed item and selects it", async () => {
    mountStore(null)
    useUIStore.setState({ organizerRevealId: "target" })
    render(<BookmarkOrganizerSheet />)

    // Two folders deep, and hidden by "Folders Only" until the reveal.
    expect(await screen.findByText("Target Bookmark")).toBeTruthy()
    await waitFor(() => {
      const selected = document.querySelector(
        "[role='treeitem'][aria-selected='true']"
      )
      expect(selected?.textContent).toContain("Target Bookmark")
    })
  })

  it("widens past a pinned root folder without changing the saved one", async () => {
    mountStore("other")
    useUIStore.setState({ organizerRevealId: "target" })
    render(<BookmarkOrganizerSheet />)

    expect(await screen.findByText("Target Bookmark")).toBeTruthy()
    expect(
      screen.getByText(
        "Widened to the whole source to show a search result. Your saved root folder is unchanged."
      )
    ).toBeTruthy()
    // The dashboard's root is a saved preference: revealing must not write it.
    expect(useBookmarkStore.getState().rootFolderId).toBe("other")
  })

  it("leaves the pinned root alone when the item is already inside it", async () => {
    mountStore("work")
    useUIStore.setState({ organizerRevealId: "target" })
    render(<BookmarkOrganizerSheet />)

    expect(await screen.findByText("Target Bookmark")).toBeTruthy()
    expect(
      screen.getByText("Changes apply to the selected root subtree.")
    ).toBeTruthy()
  })

  it("shows only folders again on a plain visit", async () => {
    mountStore(null)
    render(<BookmarkOrganizerSheet />)

    expect(await screen.findByText("Work")).toBeTruthy()
    expect(screen.queryByText("Target Bookmark")).toBeNull()
  })
})
