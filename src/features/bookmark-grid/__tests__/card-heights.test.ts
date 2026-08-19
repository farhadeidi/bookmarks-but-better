import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import { distributeToColumns } from "../card-heights"

function folder(id: string, bookmarkCount: number): BookmarkNode {
  return {
    id,
    title: id.toUpperCase(),
    children: Array.from({ length: bookmarkCount }, (_, i) => ({
      id: `${id}-${i}`,
      title: `Bookmark ${i}`,
      url: `https://${id}-${i}.example`,
    })),
  }
}

const NO_HEIGHTS = new Map<string, number>()

function ids(columns: BookmarkNode[][]): string[][] {
  return columns.map((column) => column.map((f) => f.id))
}

describe("distributeToColumns", () => {
  it("fills the shortest column first from the estimates", () => {
    const folders = [folder("a", 10), folder("b", 1), folder("c", 1)]

    expect(ids(distributeToColumns(folders, 2, {}, NO_HEIGHTS))).toEqual([
      ["a"],
      ["b", "c"],
    ])
  })

  it("charges a taller card to the grid estimate when the layout says grid", () => {
    const folders = [folder("a", 10), folder("b", 10), folder("c", 1)]

    // "a" as a grid is 168px against "b"'s 384px as a list, so the third card
    // stacks on "a" rather than alternating.
    expect(
      ids(distributeToColumns(folders, 2, { a: "grid" }, NO_HEIGHTS))
    ).toEqual([["a", "c"], ["b"]])
  })

  it("prefers a measured height over the card's estimate", () => {
    const folders = [folder("a", 1), folder("b", 1), folder("c", 1)]

    // On estimates alone all three cards are 96px and "c" would alternate back
    // to the first column; measuring "a" as the tall card it really is moves it.
    expect(
      ids(distributeToColumns(folders, 2, {}, new Map([["a", 400]])))
    ).toEqual([["a"], ["b", "c"]])
  })

  it("falls back to the estimate for cards that have not been measured yet", () => {
    const folders = [folder("a", 1), folder("b", 20), folder("c", 1)]

    // "b" has no measurement, so its 704px estimate still has to hold the
    // second column open for "c".
    expect(
      ids(distributeToColumns(folders, 2, {}, new Map([["a", 96]])))
    ).toEqual([["a", "c"], ["b"]])
  })

  it("keeps the gap between stacked cards in the running column height", () => {
    const folders = [
      folder("a", 1),
      folder("b", 1),
      folder("c", 1),
      folder("d", 1),
    ]
    const measured = new Map([
      ["a", 30],
      ["b", 70],
      ["c", 30],
      ["d", 40],
    ])

    // Two short cards plus their gaps stand taller than one 70px card, which is
    // what sends the last card to the second column.
    expect(ids(distributeToColumns(folders, 2, {}, measured))).toEqual([
      ["a", "c"],
      ["b", "d"],
    ])
  })

  it("returns the requested number of columns even when there is nothing to place", () => {
    expect(ids(distributeToColumns([], 3, {}, NO_HEIGHTS))).toEqual([
      [],
      [],
      [],
    ])
  })
})
