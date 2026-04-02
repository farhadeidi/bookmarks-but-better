import { describe, expect, it } from "vitest"
import {
  buildSequentialMoves,
  getBranchIdsToRefresh,
} from "../bookmark-organizer-reorder"
import type { OrganizerItemData } from "../bookmark-organizer-types"

describe("buildSequentialMoves", () => {
  it("builds sequential moves for reordered siblings under the same parent", () => {
    const items: OrganizerItemData[] = [
      {
        id: "c",
        title: "C",
        kind: "bookmark",
        parentId: "parent-1",
        index: 5,
        childCount: 0,
      },
      {
        id: "a",
        title: "A",
        kind: "bookmark",
        parentId: "parent-1",
        index: 1,
        childCount: 0,
      },
      {
        id: "b",
        title: "B",
        kind: "folder",
        parentId: "parent-1",
        index: 3,
        childCount: 0,
      },
    ]

    expect(buildSequentialMoves(items, "parent-1")).toEqual([
      { id: "c", parentId: "parent-1", index: 0 },
      { id: "a", parentId: "parent-1", index: 1 },
      { id: "b", parentId: "parent-1", index: 2 },
    ])
  })
})

describe("getBranchIdsToRefresh", () => {
  it("dedupes branch ids and preserves deterministic order", () => {
    expect(
      getBranchIdsToRefresh({
        sourceParentId: "source",
        destinationParentId: "source",
        movedId: "moved",
      })
    ).toEqual(["source", "moved"])
  })
})
