// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Mock } from "vitest"
import { cleanup, render } from "@testing-library/react"
import type { BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { DND_TYPE } from "../types"

/**
 * The grid's drop routing, exercised through the real component.
 *
 * Regression cover for the daemon main grid: dragging a card's bookmarks
 * *looked* like it worked — the drag preview and drop indicator are owned by
 * the sortable hooks, not by this monitor — while the drop itself was dropped
 * on the floor, because every ordering path here was gated on
 * `capabilities.reorder`, which the daemon sets false. Ordering in daemon mode
 * lives on `setChildOrder` instead.
 *
 * `monitorForElements` is stubbed so a drop can be delivered without a real
 * drag, and `extractClosestEdge` so the edge can be a plain field rather than
 * the library's symbol-keyed one. `getReorderDestinationIndex` stays real —
 * translating an edge and a target index into a destination index is exactly
 * the arithmetic these assertions depend on.
 */

let capturedOnDrop: ((args: unknown) => void) | null = null

vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", () => ({
  monitorForElements: ({ onDrop }: { onDrop: (args: unknown) => void }) => {
    capturedOnDrop = onDrop
    return () => {
      capturedOnDrop = null
    }
  },
}))

vi.mock("@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge", () => ({
  extractClosestEdge: (data: Record<string, unknown> | null) =>
    (data?.closestEdge as string | null) ?? null,
}))

const { DndMonitor } = await import("../dnd-monitor")

const TREE = [
  {
    id: "root",
    title: "Root",
    children: [
      {
        id: "work",
        title: "Work",
        children: [
          { id: "sub", title: "Sub", children: [] },
          { id: "b1", title: "One", url: "https://one.example" },
          { id: "b2", title: "Two", url: "https://two.example" },
          { id: "b3", title: "Three", url: "https://three.example" },
        ],
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

const DAEMON: Capabilities = {
  openInManager: false,
  move: true,
  reorder: false,
  setChildOrder: true,
}

const EXTENSION: Capabilities = {
  openInManager: true,
  move: true,
  reorder: true,
  setChildOrder: false,
}

function adapterWith(
  capabilities: Capabilities,
  hasSetChildOrder = capabilities.setChildOrder
): BrowserAdapter {
  return {
    bookmarks: {
      ...(hasSetChildOrder ? { setChildOrder: vi.fn() } : {}),
    },
    storage: {},
    favicon: {},
    capabilities,
  } as unknown as BrowserAdapter
}

let moveBookmark: Mock
let setChildOrder: Mock
let setFolderOrder: Mock

function mount(capabilities: Capabilities, hasSetChildOrder?: boolean) {
  useBookmarkStore.setState({
    adapter: adapterWith(capabilities, hasSetChildOrder),
    tree: TREE,
    rootFolder: TREE[0],
    moveBookmark,
    setChildOrder,
  })
  render(<DndMonitor />)
}

/** Delivers a drop the way `monitorForElements` would. */
function drop(
  source: Record<string, unknown>,
  target: Record<string, unknown>
) {
  if (!capturedOnDrop) throw new Error("monitorForElements was never called")
  capturedOnDrop({
    source: { data: source },
    location: { current: { dropTargets: [{ data: target }] } },
  })
}

function bookmark(id: string, folderId: string, index: number) {
  return { type: DND_TYPE.BOOKMARK, id, folderId, index }
}

describe("DndMonitor", () => {
  beforeEach(() => {
    moveBookmark = vi.fn().mockResolvedValue(true)
    setChildOrder = vi.fn().mockResolvedValue(true)
    setFolderOrder = vi.fn()
    usePreferencesStore.setState({
      nestedFolders: true,
      folderOrder: [],
      setFolderOrder,
    })
  })

  afterEach(() => {
    cleanup()
    capturedOnDrop = null
    vi.clearAllMocks()
  })

  describe("same-folder bookmark reorder in daemon mode", () => {
    it("writes the folder's whole child order through setChildOrder", () => {
      mount(DAEMON)

      // Drag `b1` (bookmark index 0) below `b3` (bookmark index 2).
      drop(bookmark("b1", "work", 0), {
        ...bookmark("b3", "work", 2),
        closestEdge: "bottom",
      })

      expect(setChildOrder).toHaveBeenCalledTimes(1)
      // The sub-folder keeps its absolute position; only the bookmarks move.
      expect(setChildOrder).toHaveBeenCalledWith("work", [
        "sub",
        "b2",
        "b3",
        "b1",
      ])
      // The daemon's `move()` has no index, so nothing may travel that way.
      expect(moveBookmark).not.toHaveBeenCalled()
    })

    it("reorders upward as well", () => {
      mount(DAEMON)

      drop(bookmark("b3", "work", 2), {
        ...bookmark("b1", "work", 0),
        closestEdge: "top",
      })

      expect(setChildOrder).toHaveBeenCalledWith("work", [
        "sub",
        "b3",
        "b1",
        "b2",
      ])
    })

    it("writes nothing when the drop lands on the item's own position", () => {
      mount(DAEMON)

      drop(bookmark("b2", "work", 1), {
        ...bookmark("b1", "work", 0),
        closestEdge: "bottom",
      })

      expect(setChildOrder).not.toHaveBeenCalled()
      expect(moveBookmark).not.toHaveBeenCalled()
    })

    it("writes nothing when the capability is claimed but the method is absent", () => {
      mount(DAEMON, false)

      drop(bookmark("b1", "work", 0), {
        ...bookmark("b3", "work", 2),
        closestEdge: "bottom",
      })

      expect(setChildOrder).not.toHaveBeenCalled()
      expect(moveBookmark).not.toHaveBeenCalled()
    })
  })

  /**
   * A drag carries the positions the card rendered when the gesture began. The
   * folder can change underneath it — an SSE event, a refresh, another tab —
   * and because the daemon path writes the folder's *whole* order in one
   * request, trusting those numbers meant a stale one could address a
   * different row and reorder a bookmark the user never touched.
   *
   * The live tree in these tests is always `sub, b1, b2, b3`; only the indices
   * the drag reports are stale.
   */
  describe("stale drag data in daemon mode", () => {
    it("moves the bookmark the drag names, not the one at its stale index", () => {
      mount(DAEMON)

      // `b3` reports position 1 — where it sat before the folder changed.
      // Honouring that number would move `b2`, which is at 1 now.
      drop(bookmark("b3", "work", 1), {
        ...bookmark("b1", "work", 0),
        closestEdge: "top",
      })

      expect(setChildOrder).toHaveBeenCalledWith("work", [
        "sub",
        "b3",
        "b1",
        "b2",
      ])
    })

    it("lands beside the target the drag names, not its stale index", () => {
      mount(DAEMON)

      // `b3` is the target but reports position 1, where `b2` now sits.
      drop(bookmark("b1", "work", 0), {
        ...bookmark("b3", "work", 1),
        closestEdge: "bottom",
      })

      expect(setChildOrder).toHaveBeenCalledWith("work", [
        "sub",
        "b2",
        "b3",
        "b1",
      ])
    })

    it("writes nothing when the live positions mean no change", () => {
      mount(DAEMON)

      // Stale source index 0 would compute a real move; `b3`'s live position
      // is already directly after `b2`, so the honest answer is silence.
      drop(bookmark("b3", "work", 0), {
        ...bookmark("b2", "work", 1),
        closestEdge: "bottom",
      })

      expect(setChildOrder).not.toHaveBeenCalled()
      expect(moveBookmark).not.toHaveBeenCalled()
    })

    it("writes nothing when the dragged bookmark is no longer in the folder", () => {
      mount(DAEMON)

      drop(bookmark("gone", "work", 0), {
        ...bookmark("b3", "work", 2),
        closestEdge: "bottom",
      })

      expect(setChildOrder).not.toHaveBeenCalled()
      expect(moveBookmark).not.toHaveBeenCalled()
    })

    it("writes nothing when the target bookmark is no longer in the folder", () => {
      mount(DAEMON)

      drop(bookmark("b1", "work", 0), {
        ...bookmark("gone", "work", 2),
        closestEdge: "bottom",
      })

      expect(setChildOrder).not.toHaveBeenCalled()
      expect(moveBookmark).not.toHaveBeenCalled()
    })

    it("writes nothing when the folder itself is gone from the tree", () => {
      mount(DAEMON)

      drop(bookmark("x1", "vanished", 0), {
        ...bookmark("x2", "vanished", 1),
        closestEdge: "bottom",
      })

      expect(setChildOrder).not.toHaveBeenCalled()
      expect(moveBookmark).not.toHaveBeenCalled()
    })
  })

  describe("cross-folder move in daemon mode", () => {
    it("still travels on move(), not on setChildOrder", () => {
      mount(DAEMON)

      drop(bookmark("b1", "work", 0), {
        ...bookmark("b9", "play", 0),
        closestEdge: "bottom",
      })

      expect(moveBookmark).toHaveBeenCalledWith("b1", {
        parentId: "play",
        index: 1,
      })
      expect(setChildOrder).not.toHaveBeenCalled()
    })
  })

  describe("folder-card reorder", () => {
    it("updates the client-local preference in daemon mode", () => {
      mount(DAEMON)

      drop(
        { type: DND_TYPE.FOLDER_CARD, id: "work", index: 0 },
        {
          type: DND_TYPE.FOLDER_CARD,
          id: "play",
          index: 1,
          closestEdge: "bottom",
        }
      )

      expect(setFolderOrder).toHaveBeenCalledWith(["play", "work"])
      // Card order is a UI preference; no adapter write may accompany it.
      expect(setChildOrder).not.toHaveBeenCalled()
      expect(moveBookmark).not.toHaveBeenCalled()
    })

    it("behaves identically in extension mode", () => {
      mount(EXTENSION)

      drop(
        { type: DND_TYPE.FOLDER_CARD, id: "work", index: 0 },
        {
          type: DND_TYPE.FOLDER_CARD,
          id: "play",
          index: 1,
          closestEdge: "bottom",
        }
      )

      expect(setFolderOrder).toHaveBeenCalledWith(["play", "work"])
    })
  })

  describe("extension mode is unchanged", () => {
    it("routes a same-folder reorder through move(index)", () => {
      mount(EXTENSION)

      drop(bookmark("b1", "work", 0), {
        ...bookmark("b3", "work", 2),
        closestEdge: "bottom",
      })

      expect(moveBookmark).toHaveBeenCalledWith("b1", {
        parentId: "work",
        index: 2,
      })
      expect(setChildOrder).not.toHaveBeenCalled()
    })

    it("routes a cross-folder move through move(parentId)", () => {
      mount(EXTENSION)

      drop(bookmark("b1", "work", 0), {
        ...bookmark("b9", "play", 0),
        closestEdge: "top",
      })

      expect(moveBookmark).toHaveBeenCalledWith("b1", {
        parentId: "play",
        index: 0,
      })
      expect(setChildOrder).not.toHaveBeenCalled()
    })
  })
})
