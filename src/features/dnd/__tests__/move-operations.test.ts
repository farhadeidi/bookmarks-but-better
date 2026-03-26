import { describe, it, expect } from "vitest"
import { sortFoldersByOrder, reorderArray } from "../move-operations"
import type { BookmarkNode } from "@/browser"

function makeFolder(id: string): BookmarkNode {
  return { id, title: `Folder ${id}`, children: [] }
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
    const folders = [makeFolder("c"), makeFolder("a"), makeFolder("b"), makeFolder("d")]
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
