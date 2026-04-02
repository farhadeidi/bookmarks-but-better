import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  BOOKMARK_ORGANIZER_ROOT_ID,
  loadOrganizerChildren,
  loadOrganizerItem,
} from "../bookmark-organizer-data"

type MockChromeBookmarks = {
  getChildren: ReturnType<typeof vi.fn>
  get: ReturnType<typeof vi.fn>
}

function setChromeBookmarks(mock: MockChromeBookmarks) {
  vi.stubGlobal("chrome", {
    bookmarks: mock,
  })
}

describe("bookmark organizer data helpers", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns empty children for the organizer root sentinel and null", async () => {
    const getChildren = vi.fn()
    setChromeBookmarks({
      getChildren,
      get: vi.fn(),
    })

    await expect(loadOrganizerChildren(null)).resolves.toEqual([])
    await expect(loadOrganizerChildren(BOOKMARK_ORGANIZER_ROOT_ID)).resolves.toEqual([])
    expect(getChildren).not.toHaveBeenCalled()
  })

  it("maps folder and bookmark children with indexes and title fallbacks", async () => {
    const getChildren = vi.fn().mockImplementation(async (id: string) => {
      if (id === "parent-1") {
        return [
          {
            id: "folder-1",
            title: "",
            parentId: "parent-1",
          },
          {
            id: "bookmark-2",
            title: "",
            parentId: "parent-1",
            url: "https://example.org",
          },
        ]
      }

      if (id === "folder-1") {
        return [
          { id: "child-1", title: "Child 1", parentId: "folder-1", url: "https://example.com" },
          { id: "child-2", title: "Child 2", parentId: "folder-1", url: "https://example.net" },
        ]
      }

      return []
    })
    setChromeBookmarks({
      getChildren,
      get: vi.fn(),
    })

    await expect(loadOrganizerChildren("parent-1")).resolves.toEqual([
      {
        id: "folder-1",
        title: "Untitled Folder",
        kind: "folder",
        parentId: "parent-1",
        index: 0,
        childCount: 2,
      },
      {
        id: "bookmark-2",
        title: "Untitled Bookmark",
        kind: "bookmark",
        parentId: "parent-1",
        index: 1,
        childCount: 0,
      },
    ])
    expect(getChildren).toHaveBeenCalledTimes(2)
    expect(getChildren).toHaveBeenNthCalledWith(1, "parent-1")
    expect(getChildren).toHaveBeenNthCalledWith(2, "folder-1")
  })

  it("returns null for the organizer root sentinel and missing items", async () => {
    const get = vi.fn().mockResolvedValue([])
    setChromeBookmarks({
      getChildren: vi.fn(),
      get,
    })

    await expect(loadOrganizerItem(null)).resolves.toBeNull()
    await expect(loadOrganizerItem(BOOKMARK_ORGANIZER_ROOT_ID)).resolves.toBeNull()
    await expect(loadOrganizerItem("missing")).resolves.toBeNull()
    expect(get).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenCalledWith("missing")
  })

  it("maps a folder node correctly", async () => {
    const getChildren = vi.fn().mockResolvedValue([
      { id: "child-1", title: "Child", parentId: "folder-1", url: "https://example.com" },
      { id: "child-2", title: "", parentId: "folder-1", url: "https://example.org" },
    ])
    setChromeBookmarks({
      getChildren,
      get: vi.fn().mockResolvedValue([
        {
          id: "folder-1",
          title: "",
          parentId: "parent-1",
        },
      ]),
    })

    await expect(loadOrganizerItem("folder-1")).resolves.toEqual({
      id: "folder-1",
      title: "Untitled Folder",
      kind: "folder",
      parentId: "parent-1",
      index: 0,
      childCount: 2,
    })
    expect(getChildren).toHaveBeenCalledTimes(1)
    expect(getChildren).toHaveBeenCalledWith("folder-1")
  })
})
