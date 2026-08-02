import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import { exportFileName, resolveExportTree } from "./export-scope"

const TREE: BookmarkNode[] = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "1",
        title: "Bookmarks Bar",
        children: [{ id: "10", title: "Work", children: [] }],
      },
      { id: "2", title: "Other Bookmarks", children: [] },
    ],
  },
]

describe("resolveExportTree", () => {
  it("returns only the dashboard root subtree", () => {
    expect(resolveExportTree(TREE, "10", "dashboard")).toEqual([
      { id: "10", title: "Work", children: [] },
    ])
  })

  it("returns the whole tree for the everything scope", () => {
    expect(resolveExportTree(TREE, "10", "everything")).toBe(TREE)
  })

  it("returns the whole tree when no root folder is selected", () => {
    expect(resolveExportTree(TREE, null, "dashboard")).toBe(TREE)
  })

  it("falls back to the whole tree rather than exporting nothing for a stale root id", () => {
    expect(resolveExportTree(TREE, "gone", "dashboard")).toBe(TREE)
  })
})

describe("exportFileName", () => {
  it("uses a plain name for a full export", () => {
    expect(exportFileName("everything", "Work")).toBe("bookmarks.html")
  })

  it("slugs the root folder title", () => {
    expect(exportFileName("dashboard", "Personal Bookmarks")).toBe(
      "bookmarks-personal-bookmarks.html"
    )
  })

  it("never produces a name containing a path separator", () => {
    expect(exportFileName("dashboard", "a/b: c")).toBe("bookmarks-a-b-c.html")
  })

  it("falls back when the title slugs to nothing", () => {
    expect(exportFileName("dashboard", "///")).toBe("bookmarks.html")
    expect(exportFileName("dashboard", null)).toBe("bookmarks.html")
  })
})
