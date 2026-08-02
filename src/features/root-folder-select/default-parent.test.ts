import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import {
  resolveCreateParentId,
  resolveDefaultCreateParentId,
  resolveEffectiveCreateParentId,
} from "./default-parent"

describe("resolveDefaultCreateParentId", () => {
  it("picks the Bookmarks Bar out of a Chrome-shaped root", () => {
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

  it("picks the Bookmarks Toolbar out of a Firefox-shaped root, not the Bookmarks Menu that comes first", () => {
    const tree: BookmarkNode[] = [
      {
        id: "root________",
        title: "",
        children: [
          { id: "menu________", title: "Bookmarks Menu", children: [] },
          { id: "toolbar_____", title: "Bookmarks Toolbar", children: [] },
          { id: "unfiled_____", title: "Other Bookmarks", children: [] },
          { id: "mobile______", title: "Mobile Bookmarks", children: [] },
        ],
      },
    ]

    expect(resolveDefaultCreateParentId(tree)).toBe("toolbar_____")
  })

  it("falls back to the first child folder when no known bookmarks bar id is present", () => {
    const tree: BookmarkNode[] = [
      {
        id: "root",
        title: "",
        children: [
          { id: "custom-a", title: "Some Folder", children: [] },
          { id: "custom-b", title: "Another Folder", children: [] },
        ],
      },
    ]

    expect(resolveDefaultCreateParentId(tree)).toBe("custom-a")
  })

  it("skips bookmarks sitting directly under the root when falling back", () => {
    const tree: BookmarkNode[] = [
      {
        id: "root",
        title: "",
        children: [
          { id: "b1", title: "A bookmark", url: "https://example.com" },
          { id: "f1", title: "A folder", children: [] },
        ],
      },
    ]

    expect(resolveDefaultCreateParentId(tree)).toBe("f1")
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

  it("refuses to create under tree[0] when it is a bookmark, whatever the flag claims", () => {
    const tree: BookmarkNode[] = [
      { id: "b1", title: "A bookmark", url: "https://example.com" },
      { id: "f1", title: "A folder", children: [] },
    ]

    // Creating under a bookmark is accepted by some stores and then renders
    // nowhere, so this must never be the answer.
    expect(resolveEffectiveCreateParentId(tree, true)).not.toBe("b1")
  })
})

describe("resolveCreateParentId", () => {
  const tree: BookmarkNode[] = [
    {
      id: "0",
      title: "",
      children: [
        {
          id: "1",
          title: "Bookmarks Bar",
          children: [{ id: "10", title: "Work", children: [] }],
        },
      ],
    },
  ]

  it("honours a root folder that still exists, at any depth", () => {
    expect(resolveCreateParentId(tree, "10", false)).toBe("10")
  })

  it("falls back rather than writing into a root folder that is gone", () => {
    expect(resolveCreateParentId(tree, "deleted", false)).toBe("1")
  })

  it("falls back to the vault root for daemon and standalone", () => {
    const vault: BookmarkNode[] = [
      { id: "vault", title: "Vault", children: [] },
    ]

    expect(resolveCreateParentId(vault, "deleted", true)).toBe("vault")
  })

  it("falls back when no root folder is set at all", () => {
    expect(resolveCreateParentId(tree, null, false)).toBe("1")
  })

  it("returns null when there is nowhere to write", () => {
    expect(resolveCreateParentId([], "anything", false)).toBeNull()
  })
})
