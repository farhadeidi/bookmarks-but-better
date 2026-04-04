import * as React from "react"
import { useTree } from "@headless-tree/react"
import {
  asyncDataLoaderFeature,
  createOnDropHandler,
  dragAndDropFeature,
  propMemoizationFeature,
} from "@headless-tree/core"
import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { loadOrganizerChildren, loadOrganizerItem } from "./bookmark-organizer-data"
import { BOOKMARK_ORGANIZER_ROOT_ID, type OrganizerItemData } from "./bookmark-organizer-types"
import { buildSequentialMoves } from "./bookmark-organizer-reorder"
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
    bookmarks: Pick<BookmarkAdapter, "getSubTree">
    showBookmarks: boolean
  }
>(function BookmarkOrganizerTreeImpl(
  { effectiveRootId, bookmarks, showBookmarks },
  ref
) {
  const openEditor = useUIStore((s) => s.openEditor)
  const openDeleteConfirm = useUIStore((s) => s.openDeleteConfirm)
  const openCreateItem = useUIStore((s) => s.openCreateItem)
  const moveBookmark = useBookmarkStore((s) => s.moveBookmark)

  const hasAutoExpanded = React.useRef(false)

  const tree = useTree<OrganizerItemData>({
    rootItemId: BOOKMARK_ORGANIZER_ROOT_ID,
    initialState: {
      expandedItems: [BOOKMARK_ORGANIZER_ROOT_ID],
    },
    canReorder: true,
    indent: 16,
    seperateDragHandle: true,
    features: [asyncDataLoaderFeature, dragAndDropFeature, propMemoizationFeature],
    dataLoader: {
      getItem: async (id) => {
        if (id === BOOKMARK_ORGANIZER_ROOT_ID) {
          return ROOT_ITEM_DATA
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

          return loadOrganizerChildren(bookmarks, effectiveRootId).then((items) =>
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
    onDrop: createOnDropHandler(async (item, newChildren) => {
      const parentTreeItem = item.getTree().getItemInstance(item.getId())
      const parentId =
        item.getId() === BOOKMARK_ORGANIZER_ROOT_ID
          ? effectiveRootId
          : item.getId()

      if (!parentId) {
        return
      }

      const items = await Promise.all(
        newChildren.map(async (childId) => {
          return (
            (await loadOrganizerItem(bookmarks, childId)) ??
            createMissingOrganizerItem(childId, parentId)
          )
        })
      )

      const moves = buildSequentialMoves(items, parentId)

      for (const move of moves) {
        await moveBookmark(move.id, {
          parentId: move.parentId ?? undefined,
          index: move.index,
        })
      }

      await parentTreeItem.invalidateChildrenIds(true)
    }),
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
      const id = parentId === effectiveRootId ? BOOKMARK_ORGANIZER_ROOT_ID : parentId
      void tree.getItemInstance(id).invalidateChildrenIds(true)
    },
  }))

  React.useEffect(() => {
    hasAutoExpanded.current = false
    void tree.getItemInstance(BOOKMARK_ORGANIZER_ROOT_ID).invalidateChildrenIds(true)
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

  return (
    <div
      {...tree.getContainerProps("Bookmark Organizer")}
      className="space-y-1"
    >
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
                childCount: itemData.kind === "folder" ? itemData.childCount : undefined,
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
  const effectiveRootId = rootFolderId ?? tree[0]?.id ?? null

  if (!adapter) {
    return <BookmarkOrganizerUnavailable />
  }

  return (
    <BookmarkOrganizerTreeImpl
      ref={treeRef}
      effectiveRootId={effectiveRootId}
      bookmarks={adapter.bookmarks}
      showBookmarks={showBookmarks}
    />
  )
}
