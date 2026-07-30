import { describe, it, expect } from "vitest"
import {
  sortFoldersByOrder,
  reorderArray,
  buildChildOrderForBookmarkReorder,
} from "../move-operations"
import type { BookmarkNode } from "@/browser"

function makeFolder(id: string): BookmarkNode {
  return { id, title: `Folder ${id}`, children: [] }
}

function makeBookmark(id: string): BookmarkNode {
  return { id, title: `Bookmark ${id}`, url: `https://example.com/${id}` }
}

describe("reorderArray", () => {
  it("moves item forward", () => {
    expect(reorderArray(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"])
  })

  it("moves item backward", () => {
    expect(reorderArray(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"])
  })

  it("returns same array for same index", () => {
    const arr = ["a", "b", "c"]
    expect(reorderArray(arr, 1, 1)).toBe(arr)
  })

  it("does not mutate original", () => {
    const arr = ["a", "b", "c"]
    reorderArray(arr, 0, 2)
    expect(arr).toEqual(["a", "b", "c"])
  })
})

describe("sortFoldersByOrder", () => {
  it("sorts folders according to order", () => {
    const folders = [makeFolder("c"), makeFolder("a"), makeFolder("b")]
    const result = sortFoldersByOrder(folders, ["b", "a", "c"])
    expect(result.map((f) => f.id)).toEqual(["b", "a", "c"])
  })

  it("puts unordered folders after ordered ones", () => {
    const folders = [
      makeFolder("c"),
      makeFolder("a"),
      makeFolder("b"),
      makeFolder("d"),
    ]
    const result = sortFoldersByOrder(folders, ["b", "a"])
    expect(result.map((f) => f.id)).toEqual(["b", "a", "c", "d"])
  })

  it("returns original order when folderOrder is empty", () => {
    const folders = [makeFolder("c"), makeFolder("a"), makeFolder("b")]
    expect(sortFoldersByOrder(folders, [])).toBe(folders)
  })

  it("handles folderOrder with IDs not in folders", () => {
    const folders = [makeFolder("a"), makeFolder("b")]
    const result = sortFoldersByOrder(folders, ["x", "b", "a", "z"])
    expect(result.map((f) => f.id)).toEqual(["b", "a"])
  })

  it("does not mutate original array", () => {
    const folders = [makeFolder("c"), makeFolder("a"), makeFolder("b")]
    const original = folders.map((f) => f.id)
    sortFoldersByOrder(folders, ["b", "a", "c"])
    expect(folders.map((f) => f.id)).toEqual(original)
  })
})

describe("buildChildOrderForBookmarkReorder", () => {
  const abc = () => [makeBookmark("a"), makeBookmark("b"), makeBookmark("c")]

  it("permutes bookmarks and returns the folder's whole child order", () => {
    expect(
      buildChildOrderForBookmarkReorder({
        children: abc(),
        sourceId: "a",
        targetId: "c",
        closestEdge: "bottom",
      })
    ).toEqual(["b", "c", "a"])
  })

  it("moves a bookmark backward", () => {
    expect(
      buildChildOrderForBookmarkReorder({
        children: abc(),
        sourceId: "c",
        targetId: "a",
        closestEdge: "top",
      })
    ).toEqual(["c", "a", "b"])
  })

  it("pins sub-folders at their absolute child positions", () => {
    // A card renders only `a`, `b`, `c`; positions count those alone, while
    // `f1`/`f2` must not shift.
    const children = [
      makeFolder("f1"),
      makeBookmark("a"),
      makeBookmark("b"),
      makeFolder("f2"),
      makeBookmark("c"),
    ]
    expect(
      buildChildOrderForBookmarkReorder({
        children,
        sourceId: "a",
        targetId: "c",
        closestEdge: "bottom",
      })
    ).toEqual(["f1", "b", "c", "f2", "a"])
  })

  it("returns null when the drop lands on the source's own position", () => {
    expect(
      buildChildOrderForBookmarkReorder({
        children: abc(),
        sourceId: "b",
        targetId: "a",
        closestEdge: "bottom",
      })
    ).toBeNull()
  })

  it("returns null when the dragged bookmark is gone from the folder", () => {
    // Deleted or reparented mid-drag: there is no position to infer.
    expect(
      buildChildOrderForBookmarkReorder({
        children: [makeBookmark("b"), makeBookmark("c")],
        sourceId: "a",
        targetId: "c",
        closestEdge: "bottom",
      })
    ).toBeNull()
  })

  it("returns null when the target bookmark is gone from the folder", () => {
    expect(
      buildChildOrderForBookmarkReorder({
        children: [makeBookmark("a"), makeBookmark("b")],
        sourceId: "a",
        targetId: "c",
        closestEdge: "bottom",
      })
    ).toBeNull()
  })

  it("returns null when the folder has no bookmarks left", () => {
    expect(
      buildChildOrderForBookmarkReorder({
        children: [makeFolder("f1")],
        sourceId: "a",
        targetId: "b",
        closestEdge: "bottom",
      })
    ).toBeNull()
  })

  it("ignores a sub-folder that happens to share the dragged id", () => {
    // Only the bookmark subsequence is addressable, so a folder with the same
    // id must not resolve a position.
    expect(
      buildChildOrderForBookmarkReorder({
        children: [makeFolder("a"), makeBookmark("b"), makeBookmark("c")],
        sourceId: "a",
        targetId: "c",
        closestEdge: "bottom",
      })
    ).toBeNull()
  })

  it("resolves positions from the live children, not from any snapshot", () => {
    // `a` was at bookmark position 0 when the drag began; by drop time a new
    // bookmark sits ahead of it. Binding to the id is what keeps `a` the thing
    // that moves.
    const children = [
      makeBookmark("new"),
      makeBookmark("a"),
      makeBookmark("b"),
      makeBookmark("c"),
    ]
    expect(
      buildChildOrderForBookmarkReorder({
        children,
        sourceId: "a",
        targetId: "c",
        closestEdge: "bottom",
      })
    ).toEqual(["new", "b", "c", "a"])
  })

  it("moves the id the drag names when its claimed index addresses another row", () => {
    // The reviewer's case: live order is [b2, b1, b3] while the drag payload
    // still claims b1 sits at position 0 — where b2 is now. b1 must move and
    // b2 must not.
    const children = [
      makeBookmark("b2"),
      makeBookmark("b1"),
      makeBookmark("b3"),
    ]
    expect(
      buildChildOrderForBookmarkReorder({
        children,
        sourceId: "b1",
        targetId: "b3",
        closestEdge: "bottom",
      })
    ).toEqual(["b2", "b3", "b1"])
  })

  it("passes a synthetic `!path` directory through in place", () => {
    // Such a directory has no identity an order file can record, so the daemon
    // adapter strips it read-before-write (see the daemon adapter's own tests:
    // "excludes a `!path` directory from the payload"). This function's job is
    // only to not *move* it — the grid never bypasses the adapter, so naming
    // it here is safe.
    const children = [
      makeBookmark("a"),
      { id: "!loose/dir", title: "loose", children: [] },
      makeBookmark("b"),
    ]
    expect(
      buildChildOrderForBookmarkReorder({
        children,
        sourceId: "a",
        targetId: "b",
        closestEdge: "bottom",
      })
    ).toEqual(["b", "!loose/dir", "a"])
  })

  it("does not mutate the children array", () => {
    const children = abc()
    buildChildOrderForBookmarkReorder({
      children,
      sourceId: "a",
      targetId: "c",
      closestEdge: "bottom",
    })
    expect(children.map((c) => c.id)).toEqual(["a", "b", "c"])
  })
})
