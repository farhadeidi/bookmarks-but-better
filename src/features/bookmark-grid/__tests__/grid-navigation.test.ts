import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import {
  buildNavigationColumns,
  itemAtPosition,
  planBookmarkReorder,
  resolveNavigationTarget,
  type GridNavigationItem,
} from "../grid-navigation"

/**
 * The grid's keyboard model, away from the DOM.
 *
 * The thing worth pinning here is that the arrows travel the *layout*: a
 * column of cards, not the folder list the cards were drawn from. The two
 * disagree the moment `distributeToColumns` sends the second folder to the
 * second column, which is the ordinary case.
 */

function folder(id: string, bookmarkIds: string[]): BookmarkNode {
  return {
    id,
    title: id,
    children: bookmarkIds.map((bookmarkId) => ({
      id: bookmarkId,
      title: bookmarkId,
      url: `https://${bookmarkId}.example`,
    })),
  }
}

// Two columns, each holding two cards: [alpha, gamma] and [beta, delta].
const COLUMNS: BookmarkNode[][] = [
  [folder("alpha", ["a1", "a2"]), folder("gamma", ["g1", "g2"])],
  [folder("beta", ["b1", "b2"]), folder("delta", ["d1", "d2"])],
]

function ids(columns: GridNavigationItem[][]): string[][] {
  return columns.map((column) => column.map((item) => item.id))
}

function move(activeId: string, key: string): string | null {
  return resolveNavigationTarget({
    columns: buildNavigationColumns(COLUMNS, false),
    activeId,
    key,
  })
}

describe("buildNavigationColumns", () => {
  it("walks each column card by card, heading before its bookmarks", () => {
    expect(ids(buildNavigationColumns(COLUMNS, false))).toEqual([
      ["alpha", "a1", "a2", "gamma", "g1", "g2"],
      ["beta", "b1", "b2", "delta", "d1", "d2"],
    ])
  })

  it("includes a nested sub-folder's card, in nested mode only", () => {
    const nested: BookmarkNode[][] = [
      [
        {
          id: "parent",
          title: "parent",
          children: [
            { id: "p1", title: "p1", url: "https://p1.example" },
            folder("child", ["c1"]),
          ],
        },
      ],
    ]

    expect(ids(buildNavigationColumns(nested, true))).toEqual([
      ["parent", "p1", "child", "c1"],
    ])
    expect(ids(buildNavigationColumns(nested, false))).toEqual([
      ["parent", "p1"],
    ])
  })
})

describe("resolveNavigationTarget", () => {
  it("moves down within a card", () => {
    expect(move("a1", "ArrowDown")).toBe("a2")
  })

  it("moves down across the card boundary inside the column, not to the next folder in the list", () => {
    // `gamma` is the card *below* `alpha`; `beta` is the next folder in the
    // source list, and sits in the other column.
    expect(move("a2", "ArrowDown")).toBe("gamma")
  })

  it("moves up back into the card above", () => {
    expect(move("gamma", "ArrowUp")).toBe("a2")
  })

  it("moves between columns, not between cards, on left and right", () => {
    expect(move("alpha", "ArrowRight")).toBe("beta")
    expect(move("beta", "ArrowLeft")).toBe("alpha")
    expect(move("a2", "ArrowRight")).toBe("b2")
  })

  it("keeps the row as close as a shorter neighbouring column allows", () => {
    const ragged: BookmarkNode[][] = [
      [folder("alpha", ["a1", "a2"])],
      [folder("beta", [])],
    ]

    expect(
      resolveNavigationTarget({
        columns: buildNavigationColumns(ragged, false),
        activeId: "a2",
        key: "ArrowRight",
      })
    ).toBe("beta")
  })

  it("skips a column the masonry left empty", () => {
    const withGap: BookmarkNode[][] = [
      [folder("alpha", ["a1"])],
      [],
      [folder("beta", ["b1"])],
    ]

    expect(
      resolveNavigationTarget({
        columns: buildNavigationColumns(withGap, false),
        activeId: "alpha",
        key: "ArrowRight",
      })
    ).toBe("beta")
  })

  it("takes Home and End to the ends of the column, across cards", () => {
    expect(move("g1", "Home")).toBe("alpha")
    expect(move("a1", "End")).toBe("g2")
  })

  it("stays put at the edges rather than wrapping", () => {
    expect(move("alpha", "ArrowUp")).toBeNull()
    expect(move("g2", "ArrowDown")).toBeNull()
    expect(move("alpha", "ArrowLeft")).toBeNull()
    expect(move("beta", "ArrowRight")).toBeNull()
    expect(move("alpha", "Home")).toBeNull()
    expect(move("g2", "End")).toBeNull()
  })

  it("claims neither Enter nor a printable character", () => {
    // Enter is the anchor's own default, and a character belongs to the
    // search palette's type-ahead.
    expect(move("a1", "Enter")).toBeNull()
    expect(move("a1", "g")).toBeNull()
  })
})

describe("itemAtPosition", () => {
  const columns = buildNavigationColumns(COLUMNS, false)

  it("clamps a row past the end of its column", () => {
    expect(itemAtPosition(columns, { column: 0, row: 99 })?.id).toBe("g2")
  })

  it("falls back to the nearest column that still holds something", () => {
    const withEmptyFirst = [[], columns[1]]

    expect(itemAtPosition(withEmptyFirst, { column: 0, row: 1 })?.id).toBe("b1")
  })

  it("has nothing to offer once the grid is empty", () => {
    expect(itemAtPosition([[], []], { column: 0, row: 0 })).toBeNull()
  })
})

describe("planBookmarkReorder", () => {
  // A sub-folder among the bookmarks: the card can express no position for
  // it, so a whole-folder order has to leave it where it is.
  const target: BookmarkNode = {
    id: "work",
    title: "Work",
    children: [
      { id: "b1", title: "One", url: "https://one.example" },
      { id: "sub", title: "Sub", children: [] },
      { id: "b2", title: "Two", url: "https://two.example" },
      { id: "b3", title: "Three", url: "https://three.example" },
    ],
  }

  function plan(
    bookmarkId: string,
    delta: 1 | -1,
    capabilities: { reorder: boolean; setChildOrder: boolean },
    folder: BookmarkNode | null = target
  ) {
    return planBookmarkReorder({ folder, bookmarkId, delta, capabilities })
  }

  it("positions through move() when the adapter can reorder", () => {
    expect(plan("b1", 1, { reorder: true, setChildOrder: false })).toEqual({
      kind: "move",
      id: "b1",
      parentId: "work",
      index: 1,
    })
  })

  it("writes a whole-folder order when that is the only ordering the adapter has", () => {
    expect(plan("b1", 1, { reorder: false, setChildOrder: true })).toEqual({
      kind: "child-order",
      folderId: "work",
      // The sub-folder keeps its absolute position; only the bookmark
      // subsequence is permuted.
      orderedChildIds: ["b2", "sub", "b1", "b3"],
    })
  })

  it("prefers move() over a whole-folder order when both are available", () => {
    expect(plan("b1", 1, { reorder: true, setChildOrder: true })?.kind).toBe(
      "move"
    )
  })

  it("offers nothing when the adapter can express no order at all", () => {
    expect(plan("b1", 1, { reorder: false, setChildOrder: false })).toBeNull()
    expect(plan("b1", -1, { reorder: false, setChildOrder: false })).toBeNull()
  })

  it("offers nothing for a folder whose child order is frozen", () => {
    const frozen = { ...target, orderReadOnly: true }

    expect(
      plan("b1", 1, { reorder: false, setChildOrder: true }, frozen)
    ).toBeNull()
  })

  it("offers nothing for a read-only bookmark", () => {
    const withReadOnly: BookmarkNode = {
      ...target,
      children: [
        { ...target.children![0], readOnly: true },
        ...target.children!.slice(1),
      ],
    }

    expect(
      plan("b1", 1, { reorder: true, setChildOrder: false }, withReadOnly)
    ).toBeNull()
  })

  it("stops at the ends of the folder's own bookmarks", () => {
    expect(plan("b1", -1, { reorder: true, setChildOrder: false })).toBeNull()
    expect(plan("b3", 1, { reorder: true, setChildOrder: false })).toBeNull()
  })

  it("offers nothing when the bookmark is no longer in the folder", () => {
    expect(plan("gone", 1, { reorder: true, setChildOrder: false })).toBeNull()
    expect(
      plan("b1", 1, { reorder: true, setChildOrder: false }, null)
    ).toBeNull()
  })
})
