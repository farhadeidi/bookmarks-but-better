// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { BookmarkOrganizerTree } from "../bookmark-organizer-tree"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import type { BookmarkNode } from "@/browser"

function adapterWithChildren(
  getSubTree: (id: string) => Promise<BookmarkNode[]>,
  rootIsCreatable = false
) {
  return {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue([]),
      getSubTree,
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
    storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    favicon: { getUrl: vi.fn(() => ""), isAvailable: vi.fn(() => false) },
    capabilities: {
      openInManager: true,
      move: true,
      reorder: true,
      setChildOrder: false,
      rootIsCreatable,
    },
  }
}

describe("BookmarkOrganizerTree empty state", () => {
  beforeEach(() => {
    useUIStore.setState({
      settingsOpen: false,
      bookmarkOrganizerOpen: true,
      editingBookmark: null,
      deletingItem: null,
      creatingItem: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it("offers create actions when the selected root folder has no children", async () => {
    const getSubTree = vi
      .fn()
      .mockResolvedValue([
        { id: "root-1", title: "Bookmarks Bar", children: [] },
      ])
    useBookmarkStore.setState({
      tree: [{ id: "root-1", title: "Bookmarks Bar", children: [] }],
      rootFolderId: "root-1",
      isLoading: false,
      adapter: adapterWithChildren(getSubTree),
      rootFolder: { id: "root-1", title: "Bookmarks Bar", children: [] },
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

    render(
      <BookmarkOrganizerTree
        rootFolderId="root-1"
        showBookmarks
        treeRef={{ current: null }}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          "This folder is empty. Create a folder or bookmark to get started."
        )
      ).toBeTruthy()
    })
    expect(screen.getByRole("button", { name: /New Folder/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /New Bookmark/ })).toBeTruthy()
  })

  it("shows explanatory copy with no create actions when no root folder is selected", async () => {
    const getSubTree = vi.fn().mockResolvedValue([])
    useBookmarkStore.setState({
      tree: [],
      rootFolderId: null,
      isLoading: false,
      adapter: adapterWithChildren(getSubTree),
      rootFolder: null,
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

    render(
      <BookmarkOrganizerTree
        rootFolderId={null}
        showBookmarks
        treeRef={{ current: null }}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          "Choose a root folder above before creating items here."
        )
      ).toBeTruthy()
    })
    expect(screen.queryByRole("button", { name: /New Folder/ })).toBeNull()
    expect(screen.queryByRole("button", { name: /New Bookmark/ })).toBeNull()
  })

  it("offers create actions against the vault root when no root folder is selected but the adapter allows it (daemon, standalone)", async () => {
    const getSubTree = vi
      .fn()
      .mockResolvedValue([{ id: "vault-root", title: "Vault", children: [] }])
    useBookmarkStore.setState({
      tree: [{ id: "vault-root", title: "Vault", children: [] }],
      rootFolderId: null,
      isLoading: false,
      adapter: adapterWithChildren(getSubTree, true),
      rootFolder: null,
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

    render(
      <BookmarkOrganizerTree
        rootFolderId={null}
        showBookmarks
        treeRef={{ current: null }}
      />
    )

    await waitFor(() => {
      expect(
        screen.getByText(
          "This folder is empty. Create a folder or bookmark to get started."
        )
      ).toBeTruthy()
    })
    expect(screen.getByRole("button", { name: /New Folder/ })).toBeTruthy()
    expect(screen.getByRole("button", { name: /New Bookmark/ })).toBeTruthy()
  })

  it("falls back to the tree root when the saved root folder has been deleted", async () => {
    const getSubTree = vi
      .fn()
      .mockResolvedValue([{ id: "0", title: "", children: [] }])
    useBookmarkStore.setState({
      tree: [{ id: "0", title: "", children: [] }],
      // The store resolves a saved id that no longer exists to `null`, which
      // is what tells the organizer to stop asking for that subtree.
      rootFolderId: "deleted-folder",
      rootFolder: null,
      isLoading: false,
      adapter: adapterWithChildren(getSubTree),
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

    render(
      <BookmarkOrganizerTree
        rootFolderId="deleted-folder"
        showBookmarks
        treeRef={{ current: null }}
      />
    )

    // Asking for the deleted folder would render a permanently empty tree.
    await waitFor(() => {
      expect(getSubTree).toHaveBeenCalled()
    })
    expect(getSubTree).not.toHaveBeenCalledWith("deleted-folder")
  })
})
