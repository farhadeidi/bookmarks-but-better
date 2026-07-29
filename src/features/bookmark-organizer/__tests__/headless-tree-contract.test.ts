import { describe, expect, it, vi } from "vitest"
import {
  createOnDropHandler,
  dragAndDropFeature,
  type ItemInstance,
} from "@headless-tree/core"

/**
 * Guards the two behaviours of `@headless-tree/core` that the whole ordering
 * path rests on. `package.json` pins it with a caret, so a minor bump can
 * change either one; every other test in this feature asserts the shape *our*
 * code assumes, which would stay green while every drop began writing a
 * non-permutation (`422 invalid_order`).
 *
 * These drive the real, installed library with fake item/target objects — no
 * DOM, no drag gesture, no `DataTransfer`.
 */

interface FakeItem {
  getId(): string
  getParent(): FakeItem | undefined
  getChildren(): FakeItem[]
  getTree(): unknown
  updateCachedChildrenIds(ids: string[]): void
}

/**
 * A minimal tree whose cached child lists are really mutated, because
 * `insertItemsAtTarget` reads them back *after* `removeItemsFromParents` has
 * written them — the second pass's list depends on the first pass's write.
 */
function fakeTree(children: Record<string, string[]>) {
  const cache: Record<string, string[]> = { ...children }
  const rebuildTree = vi.fn()

  const tree = {
    rebuildTree,
    waitForItemChildrenLoaded: async () => {},
    retrieveChildrenIds: (id: string) => cache[id] ?? [],
  }

  function item(id: string, parentId?: string): FakeItem {
    return {
      getId: () => id,
      getParent: () => (parentId ? item(parentId) : undefined),
      getChildren: () => (cache[id] ?? []).map((childId) => item(childId, id)),
      getTree: () => tree,
      updateCachedChildrenIds: (ids: string[]) => {
        cache[id] = ids
      },
    }
  }

  return { cache, item, rebuildTree }
}

/** Casts through `unknown`: the fakes implement only what the library calls. */
function asItem(item: FakeItem) {
  return item as unknown as ItemInstance<unknown>
}

describe("@headless-tree/core createOnDropHandler contract", () => {
  it("calls back exactly twice, removal first, for a same-parent reorder", async () => {
    const { item } = fakeTree({ parent: ["a", "b", "c"] })
    const calls: { parentId: string; newChildren: string[] }[] = []

    const handler = createOnDropHandler<unknown>((parent, newChildren) => {
      calls.push({ parentId: parent.getId(), newChildren: [...newChildren] })
    })

    await handler([asItem(item("c", "parent"))], {
      item: asItem(item("parent")),
      childIndex: 0,
      insertionIndex: 0,
      dragLineIndex: 0,
      dragLineLevel: 0,
    })

    expect(calls).toHaveLength(2)

    // Pass 1 is the removal: the dragged id CANNOT be present. This is the
    // whole basis of the guard in `bookmark-organizer-drop.ts` — PUT-ing this
    // list would describe a folder the daemon does not have.
    expect(calls[0].newChildren).not.toContain("c")
    expect(calls[0].newChildren).toEqual(["a", "b"])

    // Pass 2 is the insert: the dragged id is always spliced back in.
    expect(calls[1].newChildren).toContain("c")
    expect(calls[1].newChildren).toEqual(["c", "a", "b"])
  })

  it("calls back exactly twice for a cross-parent drop, one per side", async () => {
    const { item } = fakeTree({ source: ["x", "y"], destination: ["p", "q"] })
    const calls: { parentId: string; newChildren: string[] }[] = []

    const handler = createOnDropHandler<unknown>((parent, newChildren) => {
      calls.push({ parentId: parent.getId(), newChildren: [...newChildren] })
    })

    await handler([asItem(item("x", "source"))], {
      item: asItem(item("destination")),
      childIndex: 1,
      insertionIndex: 1,
      dragLineIndex: 0,
      dragLineLevel: 0,
    })

    expect(calls).toHaveLength(2)

    // Removal on the SOURCE, without the dragged id.
    expect(calls[0].parentId).toBe("source")
    expect(calls[0].newChildren).toEqual(["y"])

    // Insert on the DESTINATION, with it.
    expect(calls[1].parentId).toBe("destination")
    expect(calls[1].newChildren).toEqual(["p", "x", "q"])
  })

  it("still calls back exactly once per distinct source parent on a multi-select drag", async () => {
    const { item } = fakeTree({
      "source-a": ["a1", "a2"],
      "source-b": ["b1"],
      destination: [],
    })
    const calls: { parentId: string; newChildren: string[] }[] = []

    const handler = createOnDropHandler<unknown>((parent, newChildren) => {
      calls.push({ parentId: parent.getId(), newChildren: [...newChildren] })
    })

    await handler(
      [asItem(item("a1", "source-a")), asItem(item("b1", "source-b"))],
      {
        item: asItem(item("destination")),
        childIndex: 0,
        insertionIndex: 0,
        dragLineIndex: 0,
        dragLineLevel: 0,
      }
    )

    // Two removals (one per source) plus one insert. None of the removals can
    // contain a dragged id, so an N-parent drag still yields exactly one PUT.
    expect(calls).toHaveLength(3)
    expect(calls[0].newChildren).toEqual(["a2"])
    expect(calls[1].newChildren).toEqual([])
    expect(calls.slice(0, 2).flatMap((c) => c.newChildren)).not.toContain("a1")
    expect(calls[2].parentId).toBe("destination")
    expect(calls[2].newChildren).toEqual(["a1", "b1"])
  })

  it("awaits an async callback before moving to the next pass", async () => {
    const { item } = fakeTree({ parent: ["a", "b"] })
    const order: string[] = []

    const handler = createOnDropHandler<unknown>(async (_parent, children) => {
      const label = children.includes("b") ? "insert" : "removal"
      order.push(`${label}:start`)
      await Promise.resolve()
      order.push(`${label}:end`)
    })

    await handler([asItem(item("b", "parent"))], {
      item: asItem(item("parent")),
      childIndex: 0,
      insertionIndex: 0,
      dragLineIndex: 0,
      dragLineLevel: 0,
    })

    // The daemon path awaits a reparent inside the callback, so overlapping
    // passes would race a move against the order write that follows it.
    expect(order).toEqual([
      "removal:start",
      "removal:end",
      "insert:start",
      "insert:end",
    ])
  })
})

describe("@headless-tree/core dragAndDropFeature default canDrop", () => {
  it("is still `target.item.isFolder()`, which our override has to re-assert", () => {
    const defaultConfig = dragAndDropFeature.getDefaultConfig?.(
      {},
      {} as never
    ) as { canDrop?: (items: unknown, target: unknown) => boolean }

    const onFolder = defaultConfig.canDrop?.([], {
      item: { isFolder: () => true },
    })
    const onBookmark = defaultConfig.canDrop?.([], {
      item: { isFolder: () => false },
    })

    // Supplying `canDrop` REPLACES this rather than composing with it, so if
    // the library's default ever grows a second condition, `canDropOnTarget`
    // silently stops enforcing it.
    expect(onFolder).toBe(true)
    expect(onBookmark).toBe(false)
  })
})
