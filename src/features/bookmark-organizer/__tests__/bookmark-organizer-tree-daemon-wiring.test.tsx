// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Mock } from "vitest"
import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import { cleanup, render } from "@testing-library/react"
import type { TreeConfig } from "@headless-tree/core"
import type { OrganizerItemData } from "../bookmark-organizer-types"
import { BOOKMARK_ORGANIZER_ROOT_ID } from "../bookmark-organizer-types"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"

/**
 * Covers the seam between `bookmark-organizer-tree.tsx` and the extracted drop
 * module: the three lines that carry the highest-risk detail in the feature and
 * that the drop module's own tests cannot reach, because they inject
 * `draggedIds` rather than observing how the component supplies it.
 *
 * `useTree` is stubbed so the config the component builds can be inspected and
 * invoked directly — everything imported from `@headless-tree/core`
 * (`createOnDropHandler`, `isOrderedDragTarget`) stays real, so the drop really
 * is driven through the library's own two-pass machinery.
 */

let capturedConfig: TreeConfig<OrganizerItemData> | null = null

const fakeTreeInstance = {
  getContainerProps: () => ({}),
  getDragLineStyle: () => ({}),
  getItems: () => [],
  getState: () => ({}),
  getItemInstance: () => ({ invalidateChildrenIds: vi.fn() }),
}

vi.mock("@headless-tree/react", () => ({
  useTree: (config: TreeConfig<OrganizerItemData>) => {
    capturedConfig = config
    return fakeTreeInstance
  },
}))

const { BookmarkOrganizerTree } = await import("../bookmark-organizer-tree")

const ROOT_ID = "root-1"

function config(): TreeConfig<OrganizerItemData> {
  if (!capturedConfig) throw new Error("useTree was never called")
  return capturedConfig
}

/** Minimal stand-ins for the pieces of headless-tree the drop path touches. */
function dropFixtures(cachedChildren: string[]) {
  const cache: Record<string, string[]> = {
    [BOOKMARK_ORGANIZER_ROOT_ID]: [...cachedChildren],
  }
  const tree = {
    rebuildTree: vi.fn(),
    waitForItemChildrenLoaded: async () => {},
    retrieveChildrenIds: (id: string) => cache[id] ?? [],
    getItemInstance: () => ({ invalidateChildrenIds: async () => {} }),
    getItems: () => [],
  }

  const makeItem = (id: string, parentId?: string) => ({
    getId: () => id,
    getParent: () => (parentId ? makeItem(parentId) : undefined),
    getChildren: () =>
      (cache[id] ?? []).map((childId) => makeItem(childId, id)),
    getTree: () => tree,
    updateCachedChildrenIds: (ids: string[]) => {
      cache[id] = ids
    },
  })

  return { makeItem, cache }
}

function targetItem(opts: { isFolder: boolean; orderReadOnly?: boolean }): {
  item: { isFolder(): boolean; getItemData(): unknown }
} {
  return {
    item: {
      isFolder: () => opts.isFolder,
      getItemData: () => ({ orderReadOnly: opts.orderReadOnly }),
    },
  }
}

function daemonAdapter(getSubTree: BookmarkAdapter["getSubTree"]) {
  return {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue([]),
      getSubTree,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      setChildOrder: vi.fn(),
      onChanged: vi.fn(() => () => {}),
      onCreated: vi.fn(() => () => {}),
      onRemoved: vi.fn(() => () => {}),
      onMoved: vi.fn(() => () => {}),
      openInManager: vi.fn(),
    },
    storage: { get: vi.fn(), set: vi.fn(), remove: vi.fn() },
    favicon: { getUrl: vi.fn(() => ""), isAvailable: vi.fn(() => false) },
    // The daemon shape: reorder stays false, setChildOrder is the live one.
    capabilities: {
      openInManager: false,
      move: true,
      reorder: false,
      setChildOrder: true,
    },
  }
}

describe("BookmarkOrganizerTree daemon wiring", () => {
  let setChildOrder: Mock<
    (folderId: string, orderedChildIds: string[]) => Promise<boolean>
  >
  let moveBookmark: Mock<
    (
      id: string,
      destination: { parentId?: string; index: number }
    ) => Promise<boolean>
  >
  let getSubTree: Mock<(id: string) => Promise<BookmarkNode[]>>

  beforeEach(() => {
    capturedConfig = null
    setChildOrder = vi.fn().mockResolvedValue(true)
    moveBookmark = vi.fn().mockResolvedValue(true)
    getSubTree = vi.fn(async (id: string) => [
      { id, title: id, parentId: ROOT_ID },
    ])

    useUIStore.setState({
      settingsOpen: false,
      bookmarkOrganizerOpen: true,
      editingBookmark: null,
      deletingItem: null,
      creatingItem: null,
    })

    useBookmarkStore.setState({
      tree: [{ id: ROOT_ID, title: "Bookmarks Bar", children: [] }],
      rootFolderId: ROOT_ID,
      rootFolder: { id: ROOT_ID, title: "Bookmarks Bar", children: [] },
      isLoading: false,
      adapter: daemonAdapter(getSubTree),
      setChildOrder,
      moveBookmark,
    })
  })

  afterEach(() => {
    cleanup()
  })

  function renderTree() {
    render(
      <BookmarkOrganizerTree
        rootFolderId={ROOT_ID}
        showBookmarks
        treeRef={{ current: null }}
      />
    )
  }

  it("populates the dragged ids before the drop callback runs", async () => {
    renderTree()

    const { makeItem } = dropFixtures(["a", "b", "c"])
    const dragged = makeItem("c", BOOKMARK_ORGANIZER_ROOT_ID)

    await config().onDrop?.([dragged as never], {
      item: makeItem(BOOKMARK_ORGANIZER_ROOT_ID) as never,
      childIndex: 0,
      insertionIndex: 0,
      dragLineIndex: 0,
      dragLineLevel: 0,
    })

    // This is the only live input to the two-pass guard. If `draggedIdsRef`
    // were assigned after `createOnDropHandler` ran — or swapped for state,
    // which would not be visible until the next render — `draggedIds()` would
    // return an empty set, BOTH passes would look like removals, and every
    // drop would silently write nothing while all the drop-module tests
    // stayed green.
    expect(setChildOrder).toHaveBeenCalledTimes(1)
    expect(setChildOrder).toHaveBeenCalledWith(ROOT_ID, ["c", "a", "b"])
  })

  it("writes exactly one order across the library's two passes, not one per pass", async () => {
    renderTree()

    const { makeItem } = dropFixtures(["a", "b", "c"])

    await config().onDrop?.(
      [makeItem("c", BOOKMARK_ORGANIZER_ROOT_ID) as never],
      {
        item: makeItem(BOOKMARK_ORGANIZER_ROOT_ID) as never,
        childIndex: 0,
        insertionIndex: 0,
        dragLineIndex: 0,
        dragLineLevel: 0,
      }
    )

    expect(setChildOrder).toHaveBeenCalledTimes(1)
    // Same parent throughout, so nothing is reparented.
    expect(moveBookmark).not.toHaveBeenCalled()
  })

  it("binds canDrop to the ordered-target rule rather than accepting everything", () => {
    renderTree()

    const canDrop = config().canDrop
    expect(canDrop).toBeTypeOf("function")

    // An ordered target carries `childIndex`; `isOrderedDragTarget` is what
    // the component must use to tell the two apart.
    const orderedIntoFrozen = {
      ...targetItem({ isFolder: true, orderReadOnly: true }),
      childIndex: 0,
      insertionIndex: 0,
      dragLineIndex: 0,
      dragLineLevel: 0,
    }
    expect(canDrop?.([], orderedIntoFrozen as never)).toBe(false)

    // A drop ONTO the same frozen folder is a plain reparent — still allowed.
    expect(
      canDrop?.(
        [],
        targetItem({ isFolder: true, orderReadOnly: true }) as never
      )
    ).toBe(true)

    expect(
      canDrop?.([], {
        ...targetItem({ isFolder: true, orderReadOnly: false }),
        childIndex: 0,
        insertionIndex: 0,
        dragLineIndex: 0,
        dragLineLevel: 0,
      } as never)
    ).toBe(true)

    // The library default we replaced still has to hold.
    expect(canDrop?.([], targetItem({ isFolder: false }) as never)).toBe(false)
  })

  it("flows the root folder's orderReadOnly into the tree without a network read", async () => {
    useBookmarkStore.setState({
      tree: [
        {
          id: ROOT_ID,
          title: "Bookmarks Bar",
          orderReadOnly: true,
          children: [],
        },
      ],
      rootFolder: {
        id: ROOT_ID,
        title: "Bookmarks Bar",
        orderReadOnly: true,
        children: [],
      },
    })
    renderTree()

    const rootData = await config().dataLoader?.getItem?.(
      BOOKMARK_ORGANIZER_ROOT_ID
    )

    expect(rootData?.orderReadOnly).toBe(true)
    // The daemon answers GET /bookmarks/:id for a root with the whole
    // recursive subtree, so reading one boolean must not cost a refetch.
    expect(getSubTree).not.toHaveBeenCalled()
  })

  it("leaves the synthetic root unflagged when the real root is not frozen", async () => {
    renderTree()

    const rootData = await config().dataLoader?.getItem?.(
      BOOKMARK_ORGANIZER_ROOT_ID
    )

    expect(rootData?.orderReadOnly).toBeUndefined()
    expect(getSubTree).not.toHaveBeenCalled()
  })

  it("enables dragging and reordering from the ordering capability alone", () => {
    renderTree()

    // `reorder` is false for the daemon, so `canReorder` must come from
    // `setChildOrder` or same-parent drops are impossible in daemon builds.
    expect(config().canReorder).toBe(true)
  })
})

describe("BookmarkOrganizerTree extension wiring is unaffected", () => {
  beforeEach(() => {
    capturedConfig = null
    useUIStore.setState({ bookmarkOrganizerOpen: true })
  })

  afterEach(() => {
    cleanup()
  })

  it("keeps the request-free static root and the library's plain isFolder rule", async () => {
    const getSubTree: Mock<(id: string) => Promise<BookmarkNode[]>> = vi.fn(
      async () => []
    )
    const adapter = daemonAdapter(getSubTree)
    // Chrome/Firefox/Standalone: no ordering method, no ordering capability.
    adapter.capabilities = {
      openInManager: true,
      move: true,
      reorder: true,
      setChildOrder: false,
    }
    delete (adapter.bookmarks as { setChildOrder?: unknown }).setChildOrder

    useBookmarkStore.setState({
      tree: [
        {
          id: ROOT_ID,
          title: "Bookmarks Bar",
          orderReadOnly: true,
          children: [],
        },
      ],
      rootFolderId: ROOT_ID,
      rootFolder: {
        id: ROOT_ID,
        title: "Bookmarks Bar",
        orderReadOnly: true,
        children: [],
      },
      adapter,
    })

    render(
      <BookmarkOrganizerTree
        rootFolderId={ROOT_ID}
        showBookmarks
        treeRef={{ current: null }}
      />
    )

    // A frozen flag on the node must not reach an extension build's tree, and
    // `canDrop` must reduce to exactly the library default it replaced.
    const rootData = await config().dataLoader?.getItem?.(
      BOOKMARK_ORGANIZER_ROOT_ID
    )
    expect(rootData?.orderReadOnly).toBeUndefined()
    expect(getSubTree).not.toHaveBeenCalled()

    const canDrop = config().canDrop
    expect(
      canDrop?.([], {
        ...targetItem({ isFolder: true, orderReadOnly: true }),
        childIndex: 0,
        insertionIndex: 0,
        dragLineIndex: 0,
        dragLineLevel: 0,
      } as never)
    ).toBe(true)
    expect(canDrop?.([], targetItem({ isFolder: false }) as never)).toBe(false)
  })
})
