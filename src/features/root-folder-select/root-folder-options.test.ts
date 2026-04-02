import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import { buildRootFolderOptions } from "./root-folder-options"

const tree: BookmarkNode[] = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "1",
        title: "Bookmarks Bar",
        children: [
          { id: "2", title: "Design", children: [] },
          {
            id: "3",
            title: "Dev",
            children: [{ id: "4", title: "Frontend", children: [] }],
          },
        ],
      },
    ],
  },
]

describe("buildRootFolderOptions", () => {
  it("returns nested folder paths in display order", () => {
    expect(buildRootFolderOptions(tree)).toEqual([
      { id: "1", label: "Bookmarks Bar" },
      { id: "2", label: "Bookmarks Bar > Design" },
      { id: "3", label: "Bookmarks Bar > Dev" },
      { id: "4", label: "Bookmarks Bar > Dev > Frontend" },
    ])
  })
})
