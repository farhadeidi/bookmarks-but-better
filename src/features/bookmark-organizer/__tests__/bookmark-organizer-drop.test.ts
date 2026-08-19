import { beforeEach, describe, expect, it, vi } from "vitest"
import type { BookmarkNode } from "@/browser"
import {
  canDropOnTarget,
  createChildrenChangeHandler,
  type ChildrenChangeDeps,
  type DropTreeItem,
} from "../bookmark-organizer-drop"
import { BOOKMARK_ORGANIZER_ROOT_ID } from "../bookmark-organizer-types"

/**
 * These tests drive the drop callback the way `createOnDropHandler` does — the
 * removal pass first, then the insert pass — because that double invocation is
 * the single detail most likely to turn one user gesture into two conflicting
 * writes. Driving the callback directly (rather than through a rendered tree
 * and a synthetic HTML5 drag) is what makes "exactly one order write" an
 * assertion instead of a hope.
 */

const ROOT = "root-1"
const FOLDER = "folder-1"

/** parentId of every node in the fake vault, keyed by id. */
const PARENTS: Record<string, string> = {
  "bookmark-a": ROOT,
  "bookmark-b": ROOT,
  "bookmark-c": ROOT,
  [FOLDER]: ROOT,
  "nested-1": FOLDER,
}

function node(id: string): BookmarkNode {
  return {
    id,
    title: id,
    parentId: PARENTS[id],
    ...(id.startsWith("bookmark") || id.startsWith("nested")
      ? { url: `https://${id}.test` }
      : { children: [] }),
  }
}

function invalidationRecorder() {
  const invalidated: string[] = []
  const knownIds = [
    BOOKMARK_ORGANIZER_ROOT_ID,
    ROOT,
    FOLDER,
    "bookmark-a",
    "bookmark-b",
    "bookmark-c",
    "nested-1",
  ]
  const tree = {
    getItemInstance: (id: string) => ({
      invalidateChildrenIds: async () => {
        invalidated.push(id)
      },
    }),
    getItems: () => knownIds.map((id) => ({ getId: () => id })),
  }
  return { invalidated, tree }
}

function treeItem(id: string, tree: ReturnType<typeof invalidationRecorder>) {
  return { getId: () => id, getTree: () => tree.tree } as DropTreeItem
}

function makeDeps(overrides: Partial<ChildrenChangeDeps> = {}) {
  const moveBookmark = vi.fn().mockResolvedValue(true)
  const setChildOrder = vi.fn().mockResolvedValue(true)
  const getSubTree = vi.fn(async (id: string) => [node(id)])

  const deps: ChildrenChangeDeps = {
    effectiveRootId: ROOT,
    bookmarks: { getSubTree },
    moveEnabled: true,
    reorderEnabled: false,
    setChildOrderEnabled: true,
    moveBookmark,
    setChildOrder,
    draggedIds: () => new Set<string>(),
    ...overrides,
  }

  return { deps, moveBookmark, setChildOrder, getSubTree }
}

describe("organizer drop handler — daemon whole-folder ordering", () => {
  let recorder: ReturnType<typeof invalidationRecorder>

  beforeEach(() => {
    recorder = invalidationRecorder()
  })

  it("writes nothing on the removal pass and exactly one order on the insert pass", async () => {
    const dragged = new Set(["bookmark-c"])
    const { deps, moveBookmark, setChildOrder } = makeDeps({
      draggedIds: () => dragged,
    })
    const handle = createChildrenChangeHandler(deps)
    const root = treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder)

    // Pass 1 — `removeItemsFromParents`: the source folder minus the dragged
    // id. The daemon would reject this list as a non-permutation (422).
    await handle(root, ["bookmark-a", "bookmark-b"])
    expect(setChildOrder).not.toHaveBeenCalled()
    expect(moveBookmark).not.toHaveBeenCalled()

    // Pass 2 — `insertItemsAtTarget`: the destination folder including it.
    await handle(root, ["bookmark-c", "bookmark-a", "bookmark-b"])
    expect(setChildOrder).toHaveBeenCalledTimes(1)
  })

  it("sends one order write and zero moves for a same-parent reorder", async () => {
    const dragged = new Set(["bookmark-c"])
    const { deps, moveBookmark, setChildOrder } = makeDeps({
      draggedIds: () => dragged,
    })
    const handle = createChildrenChangeHandler(deps)
    const root = treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder)

    await handle(root, ["bookmark-a", "bookmark-b"])
    await handle(root, ["bookmark-c", "bookmark-a", "bookmark-b"])

    // Every child already lives in ROOT, so nothing is reparented.
    expect(moveBookmark).not.toHaveBeenCalled()
    expect(setChildOrder).toHaveBeenCalledTimes(1)
    expect(setChildOrder).toHaveBeenCalledWith(ROOT, [
      "bookmark-c",
      "bookmark-a",
      "bookmark-b",
    ])
  })

  it("maps the synthetic root id to the real root folder before ordering it", async () => {
    const dragged = new Set(["bookmark-a"])
    const { deps, setChildOrder } = makeDeps({ draggedIds: () => dragged })
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), ["bookmark-a"])

    expect(setChildOrder).toHaveBeenCalledWith(ROOT, ["bookmark-a"])
  })

  it("awaits the reparent before writing the destination order on a cross-parent drop", async () => {
    const dragged = new Set(["nested-1"])
    const calls: string[] = []
    const { deps } = makeDeps({
      draggedIds: () => dragged,
      moveBookmark: vi.fn(async () => {
        calls.push("move")
        return true
      }),
      setChildOrder: vi.fn(async () => {
        calls.push("order")
        return true
      }),
    })
    const handle = createChildrenChangeHandler(deps)
    const root = treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder)

    // Removal pass on the source folder, then insert pass on the root.
    await handle(treeItem(FOLDER, recorder), [])
    await handle(root, ["nested-1", "bookmark-a", "bookmark-b"])

    // The order below is a permutation of the destination *after* the move, so
    // the move has to land first.
    expect(calls).toEqual(["move", "order"])
    expect(deps.moveBookmark).toHaveBeenCalledWith("nested-1", {
      parentId: ROOT,
      index: 0,
    })
    expect(deps.setChildOrder).toHaveBeenCalledTimes(1)
    expect(deps.setChildOrder).toHaveBeenCalledWith(ROOT, [
      "nested-1",
      "bookmark-a",
      "bookmark-b",
    ])
  })

  it("invalidates the source branch as well as the destination after a cross-parent drop", async () => {
    const dragged = new Set(["nested-1"])
    const { deps } = makeDeps({ draggedIds: () => dragged })
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), [
      "nested-1",
      "bookmark-a",
    ])

    // The source folder must be refetched too, or it keeps rendering a child
    // that has moved away. The destination is invalidated last.
    expect(recorder.invalidated).toContain(FOLDER)
    expect(recorder.invalidated).toContain("nested-1")
    expect(recorder.invalidated.at(-1)).toBe(BOOKMARK_ORGANIZER_ROOT_ID)
  })

  it("aborts before the order write when the reparent fails, and re-reads the destination", async () => {
    const dragged = new Set(["nested-1"])
    const { deps, setChildOrder } = makeDeps({
      draggedIds: () => dragged,
      moveBookmark: vi.fn().mockResolvedValue(false),
    })
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), [
      "nested-1",
      "bookmark-a",
    ])

    // Writing an order against a folder we guessed wrong about is worse than
    // writing nothing.
    expect(setChildOrder).not.toHaveBeenCalled()
    expect(recorder.invalidated).toEqual([BOOKMARK_ORGANIZER_ROOT_ID])
  })

  it("still re-reads the destination when the order write is refused, so the row snaps back", async () => {
    const dragged = new Set(["bookmark-c"])
    const { deps } = makeDeps({
      draggedIds: () => dragged,
      setChildOrder: vi.fn().mockResolvedValue(false),
    })
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), [
      "bookmark-c",
      "bookmark-a",
    ])

    expect(recorder.invalidated).toContain(BOOKMARK_ORGANIZER_ROOT_ID)
  })

  it("refuses to reparent when the adapter cannot move, without writing a partial order", async () => {
    const dragged = new Set(["nested-1"])
    const { deps, moveBookmark, setChildOrder } = makeDeps({
      draggedIds: () => dragged,
      moveEnabled: false,
    })
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), [
      "nested-1",
      "bookmark-a",
    ])

    expect(moveBookmark).not.toHaveBeenCalled()
    expect(setChildOrder).not.toHaveBeenCalled()
    // Writing nothing is not enough: the optimistic position still has to be
    // corrected, or the row sits in a folder it never moved to.
    expect(recorder.invalidated).toEqual([BOOKMARK_ORGANIZER_ROOT_ID])
  })

  it("reads only the dragged items, not one request per row in the folder", async () => {
    const dragged = new Set(["bookmark-c"])
    const { deps, getSubTree } = makeDeps({ draggedIds: () => dragged })
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), [
      "bookmark-c",
      "bookmark-a",
      "bookmark-b",
      FOLDER,
    ])

    // Everything else travels in the order payload, which the adapter
    // validates against the server anyway.
    expect(getSubTree.mock.calls.map(([id]) => id)).toEqual(["bookmark-c"])
  })

  it("does nothing at all when there is no root folder to order", async () => {
    const { deps, setChildOrder } = makeDeps({
      effectiveRootId: null,
      draggedIds: () => new Set(["bookmark-a"]),
    })
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), ["bookmark-a"])

    expect(setChildOrder).not.toHaveBeenCalled()
    expect(recorder.invalidated).toEqual([])
  })
})

describe("canDropOnTarget", () => {
  const orderedIntoFrozen = {
    isFolder: true,
    orderReadOnly: true,
    isOrderedTarget: true,
    reorderAllowed: true,
    setChildOrderEnabled: true,
  }

  it("refuses an ordered drop into a frozen folder", () => {
    expect(canDropOnTarget(orderedIntoFrozen)).toBe(false)
  })

  it("still allows a drop ONTO a frozen folder, which needs no order file", () => {
    expect(
      canDropOnTarget({ ...orderedIntoFrozen, isOrderedTarget: false })
    ).toBe(true)
  })

  it("allows an ordered drop into an ordinary folder", () => {
    expect(
      canDropOnTarget({ ...orderedIntoFrozen, orderReadOnly: false })
    ).toBe(true)
    expect(
      canDropOnTarget({ ...orderedIntoFrozen, orderReadOnly: undefined })
    ).toBe(true)
  })

  // headless-tree's own `canReorder` covers the pointer path only, so this
  // rule is the sole thing standing between a keyboard drag and an ordered
  // position the source cannot persist.
  it("refuses an ordered drop when the source cannot express an order", () => {
    for (const setChildOrderEnabled of [true, false]) {
      for (const orderReadOnly of [true, false, undefined]) {
        expect(
          canDropOnTarget({
            isFolder: true,
            orderReadOnly,
            isOrderedTarget: true,
            reorderAllowed: false,
            setChildOrderEnabled,
          })
        ).toBe(false)
      }
    }
  })

  it("still allows a reparent ONTO a folder when the source cannot order", () => {
    expect(
      canDropOnTarget({
        ...orderedIntoFrozen,
        isOrderedTarget: false,
        reorderAllowed: false,
      })
    ).toBe(true)
  })

  it("never allows a drop onto a bookmark, matching headless-tree's built-in rule", () => {
    for (const setChildOrderEnabled of [true, false]) {
      for (const isOrderedTarget of [true, false]) {
        for (const reorderAllowed of [true, false]) {
          expect(
            canDropOnTarget({
              isFolder: false,
              orderReadOnly: undefined,
              isOrderedTarget,
              reorderAllowed,
              setChildOrderEnabled,
            })
          ).toBe(false)
        }
      }
    }
  })

  it("is exactly headless-tree's default (isFolder) for every extension build", () => {
    // The override replaces the built-in, so extension parity has to be
    // asserted rather than assumed: Chrome, Firefox and Standalone all report
    // `reorder: true` and `setChildOrder: false`, and there only isFolder
    // matters.
    for (const orderReadOnly of [true, false, undefined]) {
      for (const isOrderedTarget of [true, false]) {
        expect(
          canDropOnTarget({
            isFolder: true,
            orderReadOnly,
            isOrderedTarget,
            reorderAllowed: true,
            setChildOrderEnabled: false,
          })
        ).toBe(true)
      }
    }
  })
})

describe("organizer drop handler — legacy extension path (regression guard)", () => {
  let recorder: ReturnType<typeof invalidationRecorder>

  beforeEach(() => {
    recorder = invalidationRecorder()
  })

  /** Chrome, Firefox and Standalone all report this capability shape. */
  function extensionDeps(overrides: Partial<ChildrenChangeDeps> = {}) {
    return makeDeps({
      moveEnabled: true,
      reorderEnabled: true,
      setChildOrderEnabled: false,
      // The dragged-id guard must be unreachable on this path; a set that
      // matches nothing would silently suppress the legacy loop if it weren't.
      draggedIds: () => new Set<string>(),
      ...overrides,
    })
  }

  it("issues one sequential move per child, in list order, on BOTH passes", async () => {
    const { deps, moveBookmark, setChildOrder } = extensionDeps()
    const handle = createChildrenChangeHandler(deps)
    const root = treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder)

    // The legacy path has no notion of passes: it re-sequences whatever list
    // it is handed, both times, exactly as it did before ordering existed.
    await handle(root, ["bookmark-a", "bookmark-b"])
    expect(moveBookmark.mock.calls).toEqual([
      ["bookmark-a", { parentId: ROOT, index: 0 }],
      ["bookmark-b", { parentId: ROOT, index: 1 }],
    ])

    moveBookmark.mockClear()
    await handle(root, ["bookmark-c", "bookmark-a", "bookmark-b"])
    expect(moveBookmark.mock.calls).toEqual([
      ["bookmark-c", { parentId: ROOT, index: 0 }],
      ["bookmark-a", { parentId: ROOT, index: 1 }],
      ["bookmark-b", { parentId: ROOT, index: 2 }],
    ])

    // The whole-folder endpoint is unreachable from an extension build.
    expect(setChildOrder).not.toHaveBeenCalled()
  })

  it("reparents a cross-folder child through the same move call as every sibling", async () => {
    const { deps, moveBookmark } = extensionDeps()
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), [
      "nested-1",
      "bookmark-a",
    ])

    expect(moveBookmark.mock.calls).toEqual([
      ["nested-1", { parentId: ROOT, index: 0 }],
      ["bookmark-a", { parentId: ROOT, index: 1 }],
    ])
  })

  it("skips same-parent repositioning when the adapter cannot persist it, but still reparents", async () => {
    const { deps, moveBookmark } = extensionDeps({ reorderEnabled: false })
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), [
      "nested-1",
      "bookmark-a",
    ])

    expect(moveBookmark.mock.calls).toEqual([
      ["nested-1", { parentId: ROOT, index: 0 }],
    ])
  })

  it("invalidates only the destination branch, as it always has", async () => {
    const { deps } = extensionDeps()
    const handle = createChildrenChangeHandler(deps)

    await handle(treeItem(BOOKMARK_ORGANIZER_ROOT_ID, recorder), [
      "nested-1",
      "bookmark-a",
    ])

    expect(recorder.invalidated).toEqual([BOOKMARK_ORGANIZER_ROOT_ID])
  })
})
