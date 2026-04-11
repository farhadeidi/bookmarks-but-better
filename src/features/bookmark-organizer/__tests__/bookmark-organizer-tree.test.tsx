// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { BookmarkOrganizerTree } from "../bookmark-organizer-tree"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"

describe("BookmarkOrganizerTree", () => {
  beforeEach(() => {
    useUIStore.setState({
      settingsOpen: false,
      bookmarkOrganizerOpen: true,
      editingBookmark: null,
      deletingItem: null,
      creatingItem: null,
    })

    useBookmarkStore.setState({
      tree: [
        {
          id: "root-1",
          title: "Bookmarks Bar",
          children: [],
        },
      ],
      rootFolderId: "root-1",
      isLoading: false,
      adapter: {
        bookmarks: {
          getTree: vi.fn().mockResolvedValue([]),
          getSubTree: vi.fn().mockImplementation(async (id: string) => {
            if (id === "root-1") {
              return [
                {
                  id: "root-1",
                  title: "Bookmarks Bar",
                  children: [
                    {
                      id: "folder-1",
                      title: "Folder One",
                      parentId: "root-1",
                      children: [],
                    },
                    {
                      id: "bookmark-1",
                      title: "Bookmark One",
                      parentId: "root-1",
                      url: "https://example.com",
                    },
                  ],
                },
              ]
            }

            return []
          }),
          create: vi.fn(),
          update: vi.fn(),
          remove: vi.fn(),
          removeTree: vi.fn(),
          move: vi.fn(),
          onChanged: vi.fn(() => () => {}),
          onCreated: vi.fn(() => () => {}),
          onRemoved: vi.fn(() => () => {}),
          onMoved: vi.fn(() => () => {}),
          openInManager: vi.fn(),
        },
        storage: {
          get: vi.fn(),
          set: vi.fn(),
          remove: vi.fn(),
        },
        favicon: {
          getUrl: vi.fn(() => ""),
          isAvailable: vi.fn(() => false),
        },
        capabilities: {
          openInManager: true,
        },
      },
      rootFolder: {
        id: "root-1",
        title: "Bookmarks Bar",
        children: [],
      },
      init: vi.fn(),
      setRootFolderId: vi.fn(),
      refresh: vi.fn(),
      createBookmark: vi.fn(),
      updateBookmark: vi.fn(),
      deleteBookmark: vi.fn(),
      deleteFolder: vi.fn(),
      createFolder: vi.fn(),
      moveBookmark: vi.fn(),
    })
  })

  it("renders root children from the bookmark adapter", async () => {
    render(<BookmarkOrganizerTree rootFolderId="root-1" showBookmarks treeRef={{ current: null }} />)

    await waitFor(() => {
      expect(screen.getByText("Folder One")).toBeTruthy()
      expect(screen.getByText("Bookmark One")).toBeTruthy()
    })
  })
})
