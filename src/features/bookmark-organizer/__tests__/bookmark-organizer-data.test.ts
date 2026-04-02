import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  BOOKMARK_ORGANIZER_ROOT_ID,
  loadOrganizerChildren,
  loadOrganizerItem,
} from "../bookmark-organizer-data"

type MockBookmarks = {
  getSubTree: ReturnType<typeof vi.fn>
}

function createBookmarks(mock?: Partial<MockBookmarks>): MockBookmarks {
  return {
    getSubTree: vi.fn(),
    ...mock,
  }
}

describe("bookmark organizer data helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty children for the organizer root sentinel and null", async () => {
    const bookmarks = createBookmarks()

    await expect(loadOrganizerChildren(bookmarks, null)).resolves.toEqual([])
    await expect(
      loadOrganizerChildren(bookmarks, BOOKMARK_ORGANIZER_ROOT_ID)
    ).resolves.toEqual([])
    expect(bookmarks.getSubTree).not.toHaveBeenCalled()
  })

  it("maps folder and bookmark children with indexes and title fallbacks", async () => {
    const bookmarks = createBookmarks({
      getSubTree: vi.fn().mockResolvedValue([
        {
          id: "parent-1",
          title: "Parent",
          children: [
            {
              id: "folder-1",
              title: "",
              parentId: "parent-1",
              children: [
                {
                  id: "child-1",
                  title: "Child 1",
                  parentId: "folder-1",
                  url: "https://example.com",
                },
                {
                  id: "child-2",
                  title: "Child 2",
                  parentId: "folder-1",
                  url: "https://example.net",
                },
              ],
            },
            {
              id: "bookmark-2",
              title: "",
              parentId: "parent-1",
              url: "https://example.org",
            },
          ],
        },
      ]),
    })

    await expect(loadOrganizerChildren(bookmarks, "parent-1")).resolves.toEqual([
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
    expect(bookmarks.getSubTree).toHaveBeenCalledTimes(1)
    expect(bookmarks.getSubTree).toHaveBeenCalledWith("parent-1")
  })

  it("returns null for the organizer root sentinel and missing items", async () => {
    const bookmarks = createBookmarks({
      getSubTree: vi.fn().mockResolvedValue([]),
    })

    await expect(loadOrganizerItem(bookmarks, null)).resolves.toBeNull()
    await expect(
      loadOrganizerItem(bookmarks, BOOKMARK_ORGANIZER_ROOT_ID)
    ).resolves.toBeNull()
    await expect(loadOrganizerItem(bookmarks, "missing")).resolves.toBeNull()
    expect(bookmarks.getSubTree).toHaveBeenCalledTimes(1)
    expect(bookmarks.getSubTree).toHaveBeenCalledWith("missing")
  })

  it("maps a folder node correctly", async () => {
    const bookmarks = createBookmarks({
      getSubTree: vi.fn().mockResolvedValue([
        {
          id: "folder-1",
          title: "",
          parentId: "parent-1",
          children: [
            {
              id: "child-1",
              title: "Child",
              parentId: "folder-1",
              url: "https://example.com",
            },
            {
              id: "child-2",
              title: "",
              parentId: "folder-1",
              url: "https://example.org",
            },
          ],
        },
      ]),
    })

    await expect(loadOrganizerItem(bookmarks, "folder-1")).resolves.toEqual({
      id: "folder-1",
      title: "Untitled Folder",
      kind: "folder",
      parentId: "parent-1",
      index: 0,
      childCount: 2,
    })
    expect(bookmarks.getSubTree).toHaveBeenCalledTimes(1)
    expect(bookmarks.getSubTree).toHaveBeenCalledWith("folder-1")
  })
})
