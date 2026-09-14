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
        isTreeRoot: true,
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
        isTreeRoot: true,
      }).map((folder) => folder.id)
    ).toEqual(["c", "a", "b", "d"])
  })

  describe("when the display root itself has direct bookmarks", () => {
    const bookmarksOnlyRoot: BookmarkNode = {
      id: "root",
      title: "Social",
      children: [
        { id: "bm1", title: "Bookmark 1", url: "https://example.com/1" },
        { id: "bm2", title: "Bookmark 2", url: "https://example.com/2" },
      ],
    }

    const mixedRoot: BookmarkNode = {
      id: "root",
      title: "Mixed",
      children: [
        { id: "bm1", title: "Bookmark 1", url: "https://example.com/1" },
        { id: "a", title: "A", children: [] },
        {
          id: "c",
          title: "C",
          children: [{ id: "d", title: "D", children: [] }],
        },
      ],
    }

    it("renders a bookmarks-only root as a single root card (nested on)", () => {
      const folders = getVisibleFolders({
        displayRoot: bookmarksOnlyRoot,
        nestedFolders: true,
        experimentalCardDrag: false,
        folderOrder: [],
        isTreeRoot: false,
      })
      expect(folders.map((f) => f.id)).toEqual(["root"])
      expect(folders[0].title).toBe("Social")
      expect(folders[0].children?.map((c) => c.id)).toEqual(["bm1", "bm2"])
    })

    it("renders a bookmarks-only root as a single root card (nested off)", () => {
      const folders = getVisibleFolders({
        displayRoot: bookmarksOnlyRoot,
        nestedFolders: false,
        experimentalCardDrag: false,
        folderOrder: [],
        isTreeRoot: false,
      })
      expect(folders.map((f) => f.id)).toEqual(["root"])
      expect(folders[0].children?.map((c) => c.id)).toEqual(["bm1", "bm2"])
    })

    it("puts a mixed root's own bookmarks in a root card, followed by direct subfolders (nested on)", () => {
      const folders = getVisibleFolders({
        displayRoot: mixedRoot,
        nestedFolders: true,
        experimentalCardDrag: false,
        folderOrder: [],
        isTreeRoot: false,
      })
      expect(folders.map((f) => f.id)).toEqual(["root", "a", "c"])
      // The root card only carries its own bookmarks, never the subfolders
      // the grid already renders as separate cards.
      expect(folders[0].children?.map((c) => c.id)).toEqual(["bm1"])
    })

    it("puts a mixed root's own bookmarks in a root card, followed by all descendant folders (nested off)", () => {
      const folders = getVisibleFolders({
        displayRoot: mixedRoot,
        nestedFolders: false,
        experimentalCardDrag: false,
        folderOrder: [],
        isTreeRoot: false,
      })
      expect(folders.map((f) => f.id)).toEqual(["root", "a", "c", "d"])
      expect(folders[0].children?.map((c) => c.id)).toEqual(["bm1"])
    })

    it("titles a user-picked root folder's card with the folder's own name", () => {
      const folders = getVisibleFolders({
        displayRoot: bookmarksOnlyRoot,
        nestedFolders: true,
        experimentalCardDrag: false,
        folderOrder: [],
        isTreeRoot: false,
      })
      expect(folders[0].title).toBe("Social")
    })

    it("titles the source's own top-level root card 'Bookmarks' rather than its internal label", () => {
      // A daemon Vault's tree root is titled after the Vault itself (e.g.
      // "reading"); a bookmark card reusing that label would look like a
      // folder named after the source, not the loose bookmarks it actually
      // holds — so the unnarrowed top-level root gets a neutral title.
      const vaultRoot: BookmarkNode = { ...bookmarksOnlyRoot, title: "reading" }
      const folders = getVisibleFolders({
        displayRoot: vaultRoot,
        nestedFolders: true,
        experimentalCardDrag: false,
        folderOrder: [],
        isTreeRoot: true,
      })
      expect(folders[0].title).toBe("Bookmarks")
    })
  })

  describe("when the display root's direct children are all folders", () => {
    it("renders exactly as before, with no root card (nested on)", () => {
      expect(
        getVisibleFolders({
          displayRoot: tree,
          nestedFolders: true,
          experimentalCardDrag: false,
          folderOrder: [],
          isTreeRoot: true,
        }).map((folder) => folder.id)
      ).toEqual(["a", "b", "c"])
    })

    it("renders exactly as before, with no root card (nested off)", () => {
      expect(
        getVisibleFolders({
          displayRoot: tree,
          nestedFolders: false,
          experimentalCardDrag: false,
          folderOrder: [],
          isTreeRoot: true,
        }).map((folder) => folder.id)
      ).toEqual(["a", "b", "c", "d"])
    })
  })
})
