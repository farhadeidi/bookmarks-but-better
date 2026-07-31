import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import {
  resolveDefaultCreateParentId,
  resolveEffectiveCreateParentId,
} from "./default-parent"

describe("resolveDefaultCreateParentId", () => {
  it("returns the first child folder of the Chrome-shaped root", () => {
    const tree: BookmarkNode[] = [
      {
        id: "0",
        title: "",
        children: [
          { id: "1", title: "Bookmarks Bar", children: [] },
          { id: "2", title: "Other Bookmarks", children: [] },
        ],
      },
    ]

    expect(resolveDefaultCreateParentId(tree)).toBe("1")
  })

  it("returns null for an empty tree", () => {
    expect(resolveDefaultCreateParentId([])).toBeNull()
  })

  it("returns null when the root has no child folders", () => {
    const tree: BookmarkNode[] = [
      {
        id: "0",
        title: "",
        children: [
          { id: "1", title: "A bookmark", url: "https://example.com" },
        ],
      },
    ]

    expect(resolveDefaultCreateParentId(tree)).toBeNull()
  })

  it("returns null when the root has no children at all", () => {
    const tree: BookmarkNode[] = [{ id: "0", title: "", children: [] }]

    expect(resolveDefaultCreateParentId(tree)).toBeNull()
  })
})

describe("resolveEffectiveCreateParentId", () => {
  it("uses the vault root directly when the adapter allows it (daemon, standalone)", () => {
    const tree: BookmarkNode[] = [{ id: "root", title: "Vault", children: [] }]

    expect(resolveEffectiveCreateParentId(tree, true)).toBe("root")
  })

  it("falls back to the child-folder walk when the adapter does not allow it (chrome, firefox)", () => {
    const tree: BookmarkNode[] = [
      {
        id: "0",
        title: "",
        children: [{ id: "1", title: "Bookmarks Bar", children: [] }],
      },
    ]

    expect(resolveEffectiveCreateParentId(tree, false)).toBe("1")
  })

  it("returns null for an empty tree regardless of the capability", () => {
    expect(resolveEffectiveCreateParentId([], true)).toBeNull()
    expect(resolveEffectiveCreateParentId([], false)).toBeNull()
  })
})
