import * as React from "react"
import { useTree } from "@headless-tree/react"
import {
  asyncDataLoaderFeature,
  createOnDropHandler,
  dragAndDropFeature,
  isOrderedDragTarget,
  propMemoizationFeature,
} from "@headless-tree/core"
import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import {
  loadOrganizerChildren,
  loadOrganizerItem,
} from "./bookmark-organizer-data"
import {
  BOOKMARK_ORGANIZER_ROOT_ID,
  type OrganizerItemData,
} from "./bookmark-organizer-types"
import {
  canDropOnTarget,
  createChildrenChangeHandler,
} from "./bookmark-organizer-drop"
import { BookmarkOrganizerRow } from "./bookmark-organizer-row"

const ROOT_ITEM_DATA: OrganizerItemData = {
  id: BOOKMARK_ORGANIZER_ROOT_ID,
  title: "Bookmark Organizer",
  kind: "folder",
  parentId: null,
  index: 0,
  childCount: 0,
}

function createMissingOrganizerItem(
  id: string,
  parentId: string | null
): OrganizerItemData {
  return {
    id,
    title: "Missing Bookmark",
    kind: "bookmark",
    parentId,
    index: 0,
    childCount: 0,
  }
}

function toBookmarkNode(node: BookmarkNode) {
  if (node.url) {
    return {
      id: node.id,
      title: node.title,
      url: node.url,
      parentId: node.parentId,
      dateAdded: node.dateAdded,
    }
  }

  return {
    id: node.id,
    title: node.title,
    parentId: node.parentId,
    children: [],
    dateAdded: node.dateAdded,
  }
}

function BookmarkOrganizerUnavailable() {
  return (
    <p className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-sm text-muted-foreground">
      Bookmark organizer is unavailable until bookmarks are connected.
    </p>
  )
}

export type BookmarkOrganizerTreeHandle = {
  expandAll: () => void
  collapseAll: () => void
  invalidate: (parentId: string) => void
}

const BookmarkOrganizerTreeImpl = React.forwardRef<
  BookmarkOrganizerTreeHandle,
  {
    effectiveRootId: string | null
    /** Whether the effective root folder's own child order is frozen. */
    rootOrderReadOnly?: boolean
    bookmarks: Pick<BookmarkAdapter, "getSubTree">
    showBookmarks: boolean
    moveEnabled: boolean
    reorderEnabled: boolean
    setChildOrderEnabled: boolean
  }
>(function BookmarkOrganizerTreeImpl(
  {
    effectiveRootId,
    rootOrderReadOnly,
    bookmarks,
    showBookmarks,
    moveEnabled,
    reorderEnabled,
    setChildOrderEnabled,
  },
  ref
) {
  const openEditor = useUIStore((s) => s.openEditor)
  const openDeleteConfirm = useUIStore((s) => s.openDeleteConfirm)
  const openCreateItem = useUIStore((s) => s.openCreateItem)
  const moveBookmark = useBookmarkStore((s) => s.moveBookmark)
  const setChildOrder = useBookmarkStore((s) => s.setChildOrder)
  const dragEnabled = moveEnabled || reorderEnabled || setChildOrderEnabled

  const hasAutoExpanded = React.useRef(false)
  // `createOnDropHandler` invokes its callback twice per drop — once with the
  // source parent's children minus the dragged ids, once with the destination
  // parent's children plus them — and neither call says which pass it is.
  // Recording the drag's ids up front is what lets the ordering path tell them
  // apart, and a whole-folder PUT is only ever valid on the second.
  const draggedIdsRef = React.useRef<Set<string>>(new Set())

  const tree = useTree<OrganizerItemData>({
    rootItemId: BOOKMARK_ORGANIZER_ROOT_ID,
    initialState: {
      expandedItems: [BOOKMARK_ORGANIZER_ROOT_ID],
    },
    // `canReorder` controls only same-parent sibling repositioning; a drag
    // that reparents onto a different folder is still allowed when it's
    // false, since that's gated separately by `moveEnabled` below.
    canReorder: reorderEnabled || setChildOrderEnabled,
    // Mirrors headless-tree's own default (`target.item.isFolder()`), plus one
    // rule the daemon enforces anyway: a folder whose child order is frozen
    // refuses a drop *between* its children, while a drop *onto* it — a plain
    // reparent, which needs no order file — stays allowed.
    canDrop: (_items, target) =>
      canDropOnTarget({
        isFolder: target.item.isFolder(),
        orderReadOnly: target.item.getItemData()?.orderReadOnly,
        isOrderedTarget: isOrderedDragTarget(target),
        setChildOrderEnabled,
      }),
    indent: 16,
    seperateDragHandle: true,
    features: [
      asyncDataLoaderFeature,
      ...(dragEnabled ? [dragAndDropFeature] : []),
      propMemoizationFeature,
    ],
    dataLoader: {
      getItem: async (id) => {
        if (id === BOOKMARK_ORGANIZER_ROOT_ID) {
          // The synthetic root stands in for a real folder, and `canDrop`
          // needs to know whether *that* folder's order is frozen — otherwise
          // a drop between top-level rows looks legal and only fails at the
          // daemon. The flag arrives as a prop from the store's own copy of
          // that node, so this stays the request-free static literal it has
          // always been.
          return rootOrderReadOnly === undefined
            ? ROOT_ITEM_DATA
            : { ...ROOT_ITEM_DATA, orderReadOnly: rootOrderReadOnly }
        }

        return (
          (await loadOrganizerItem(bookmarks, id)) ??
          createMissingOrganizerItem(id, effectiveRootId)
        )
      },
      getChildrenWithData: async (id) => {
        if (id === BOOKMARK_ORGANIZER_ROOT_ID) {
          if (!effectiveRootId) {
            return []
          }

          return loadOrganizerChildren(bookmarks, effectiveRootId).then(
            (items) =>
              items.map((item) => ({
                id: item.id,
                data: item,
              }))
          )
        }

        const children = await loadOrganizerChildren(bookmarks, id)
        return children.map((item) => ({
          id: item.id,
          data: item,
        }))
      },
    },
    isItemFolder: (item) => item.getItemData()?.kind === "folder",
    getItemName: (item) =>
      item.getItemData()?.title ??
      (item.isFolder() ? "Untitled Folder" : "Untitled Bookmark"),
    onDrop: async (draggedItems, target) => {
      draggedIdsRef.current = new Set(draggedItems.map((i) => i.getId()))
      const onChangeChildren = createChildrenChangeHandler({
        effectiveRootId,
        bookmarks,
        moveEnabled,
        reorderEnabled,
        setChildOrderEnabled,
        moveBookmark,
        setChildOrder,
        draggedIds: () => draggedIdsRef.current,
      })
      await createOnDropHandler<OrganizerItemData>(onChangeChildren)(
        draggedItems,
        target
      )
    },
  })

  React.useImperativeHandle(ref, () => ({
    expandAll: () => {
      tree.getItems().forEach((item) => {
        if (item.isFolder() && item.getId() !== BOOKMARK_ORGANIZER_ROOT_ID) {
          item.expand()
        }
      })
    },
    collapseAll: () => {
      tree.getItems().forEach((item) => {
        if (item.isFolder() && item.getId() !== BOOKMARK_ORGANIZER_ROOT_ID) {
          item.collapse()
        }
      })
    },
    invalidate: (parentId: string) => {
      const id =
        parentId === effectiveRootId ? BOOKMARK_ORGANIZER_ROOT_ID : parentId
      void tree.getItemInstance(id).invalidateChildrenIds(true)
    },
  }))

  React.useEffect(() => {
    hasAutoExpanded.current = false
    void tree
      .getItemInstance(BOOKMARK_ORGANIZER_ROOT_ID)
      .invalidateChildrenIds(true)
  }, [effectiveRootId, tree])

  const items = tree.getItems()

  React.useEffect(() => {
    if (hasAutoExpanded.current) return

    const topLevelFolders = items.filter(
      (item) => item.isFolder() && item.getItemMeta().level === 0
    )

    if (topLevelFolders.length > 0) {
      hasAutoExpanded.current = true
      topLevelFolders.forEach((item) => item.expand())
    }
  }, [items])

  const draggedItemIds = new Set(
    tree.getState().dnd?.draggedItems?.map((i) => i.getId()) ?? []
  )

  return (
    <div
      {...tree.getContainerProps("Bookmark Organizer")}
      className="relative space-y-1"
    >
      <div
        className="h-0.5 rounded-full bg-primary"
        style={tree.getDragLineStyle()}
      />
      {tree
        .getItems()
        .filter((item) => {
          if (item.getId() === BOOKMARK_ORGANIZER_ROOT_ID) return false
          if (!showBookmarks && !item.isFolder()) return false
          return true
        })
        .map((item) => (
          <BookmarkOrganizerRow
            key={item.getId()}
            item={item}
            isDragging={draggedItemIds.has(item.getId())}
            dragEnabled={dragEnabled}
            onCreateItem={(type) => {
              openCreateItem({ type, parentId: item.getId() })
            }}
            onRename={async (treeItem) => {
              const itemData = treeItem.getItemData()
              if (!itemData) {
                return
              }

              if (itemData.kind === "folder") {
                openEditor({
                  id: itemData.id,
                  title: itemData.title,
                  parentId: itemData.parentId ?? undefined,
                  children: [],
                })
                return
              }

              const [bookmark] = await bookmarks.getSubTree(treeItem.getId())
              if (!bookmark) {
                return
              }

              openEditor(toBookmarkNode(bookmark))
            }}
            onDelete={(treeItem) => {
              const itemData = treeItem.getItemData()
              if (!itemData) {
                return
              }

              openDeleteConfirm({
                id: itemData.id,
                title: itemData.title,
                type: itemData.kind,
                childCount:
                  itemData.kind === "folder" ? itemData.childCount : undefined,
              })
            }}
          />
        ))}
    </div>
  )
})

export function BookmarkOrganizerTree({
  rootFolderId,
  showBookmarks,
  treeRef,
}: {
  rootFolderId: string | null
  showBookmarks: boolean
  treeRef: React.Ref<BookmarkOrganizerTreeHandle>
}) {
  const adapter = useBookmarkStore((s) => s.adapter)
  const tree = useBookmarkStore((s) => s.tree)
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const effectiveRootId = rootFolderId ?? tree[0]?.id ?? null
  // The store already holds this node — `rootFolder` is its own resolution of
  // `rootFolderId`, and an unpinned root is `tree[0]`. Reading the flag from
  // here rather than re-fetching matters because the daemon answers
  // `GET /bookmarks/:id` for a root with the *entire* recursive subtree, so a
  // refetch would move the whole vault across the wire to learn one boolean.
  const effectiveRootNode = [rootFolder, tree[0]].find(
    (node) => node?.id === effectiveRootId
  )

  if (!adapter) {
    return <BookmarkOrganizerUnavailable />
  }

  const setChildOrderEnabled =
    adapter.capabilities.setChildOrder &&
    adapter.bookmarks.setChildOrder !== undefined

  return (
    <BookmarkOrganizerTreeImpl
      ref={treeRef}
      effectiveRootId={effectiveRootId}
      // Gated, not just unused: an extension build's synthetic root keeps the
      // exact static item data it always had, rather than relying on
      // `canDropOnTarget` to ignore a flag it should never have been handed.
      rootOrderReadOnly={
        setChildOrderEnabled ? effectiveRootNode?.orderReadOnly : undefined
      }
      bookmarks={adapter.bookmarks}
      showBookmarks={showBookmarks}
      moveEnabled={adapter.capabilities.move}
      reorderEnabled={adapter.capabilities.reorder}
      setChildOrderEnabled={setChildOrderEnabled}
    />
  )
}
