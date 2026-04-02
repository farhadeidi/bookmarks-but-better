import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import { getVisibleFolders } from "../folder-collection"

const tree: BookmarkNode = {
  id: "root",
  title: "Root",
  children: [
    { id: "a", title: "A", children: [] },
    { id: "b", title: "B", children: [] },
    {
      id: "c",
      title: "C",
      children: [{ id: "d", title: "D", children: [] }],
    },
  ],
}

describe("getVisibleFolders", () => {
  it("uses real tree order when experimental card drag is disabled", () => {
    expect(
      getVisibleFolders({
        displayRoot: tree,
        nestedFolders: false,
        experimentalCardDrag: false,
        folderOrder: ["c", "a"],
      }).map((folder) => folder.id)
    ).toEqual(["a", "b", "c", "d"])
  })

  it("preserves legacy folderOrder compatibility when experimental card drag is enabled", () => {
    expect(
      getVisibleFolders({
        displayRoot: tree,
        nestedFolders: false,
        experimentalCardDrag: true,
        folderOrder: ["c", "a"],
      }).map((folder) => folder.id)
    ).toEqual(["c", "a", "b", "d"])
  })
})
