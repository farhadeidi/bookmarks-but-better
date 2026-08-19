import * as React from "react"
import { AssistiveTreeDescription, useTree } from "@headless-tree/react"
import {
  asyncDataLoaderFeature,
  createOnDropHandler,
  dragAndDropFeature,
  hotkeysCoreFeature,
  isOrderedDragTarget,
  keyboardDragAndDropFeature,
  propMemoizationFeature,
  selectionFeature,
  type ItemInstance,
  type TreeInstance,
} from "@headless-tree/core"
import { HugeiconsIcon } from "@hugeicons/react"
import { Bookmark02Icon, Folder01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { resolveCreateParentId } from "@/features/root-folder-select"
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

/**
 * The hotkeys that move focus towards the top of the list. Everything else
 * that moves focus moves it downwards, so naming these is enough to keep the
 * hidden-row correction below travelling the same way the user asked to.
 */
const UPWARD_HOTKEYS = new Set([
  "focusPreviousItem",
  "focusLastItem",
  "selectUpwards",
])

function findFolderFrom(
  items: ItemInstance<OrganizerItemData>[],
  start: number,
  step: number
): ItemInstance<OrganizerItemData> | undefined {
  for (let i = start; i >= 0 && i < items.length; i += step) {
    if (items[i].isFolder()) {
      return items[i]
    }
  }

  return undefined
}

/**
 * Pulls focus off a row that "Folders Only" is hiding.
 *
 * The toggle hides bookmark rows at render time but leaves them in the
 * flattened tree, so every focus-moving hotkey can land on a row that draws
 * nothing: `updateDomFocus` then polls half a second for an element that
 * never appears and resets focus to the top of the tree. Correcting after the
 * fact covers the arrows, Home/End and the selection pair in one place,
 * rather than re-implementing each of the library's handlers.
 */
function skipHiddenRows(
  tree: TreeInstance<OrganizerItemData>,
  hotkeyName: string
) {
  const focused = tree.getFocusedItem()
  if (!focused || focused.isFolder()) {
    return
  }

  const items = tree.getItems()
  const from = focused.getItemMeta().index
  const step = UPWARD_HOTKEYS.has(hotkeyName) ? -1 : 1
  // Falling back to the opposite direction is what keeps the last folder in
  // the list reachable: pressing Down past it has nowhere else to go, and
  // leaving focus on the hidden row below would strand it.
  const next =
    findFolderFrom(items, from + step, step) ??
    findFolderFrom(items, from - step, -step)

  if (!next) {
    return
  }

  next.setFocused()
  tree.updateDomFocus()
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

function BookmarkOrganizerEmpty({
  createParentId,
}: {
  createParentId: string | null
}) {
  const openCreateItem = useUIStore((s) => s.openCreateItem)

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border/70 px-3 py-8 text-center">
      <p className="text-sm text-muted-foreground">
        {createParentId
          ? "This folder is empty. Create a folder or bookmark to get started."
          : "Choose a root folder above before creating items here."}
      </p>
      {createParentId && (
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openCreateItem({ type: "folder", parentId: createParentId })
            }
          >
            <HugeiconsIcon
              icon={Folder01Icon}
              size={14}
              className="text-primary"
            />
            New Folder
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              openCreateItem({ type: "bookmark", parentId: createParentId })
            }
          >
            <HugeiconsIcon icon={Bookmark02Icon} size={14} />
            New Bookmark
          </Button>
        </div>
      )}
    </div>
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
    /** Where a "New Folder"/"New Bookmark" action should create, or `null` when nothing valid is selected — drives the empty state's copy and actions. */
    createParentId: string | null
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
    createParentId,
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
  const reorderAllowed = reorderEnabled || setChildOrderEnabled

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
    canReorder: reorderAllowed,
    // The pointer path withholds a drag from a read-only row simply by not
    // rendering its handle. A keyboard drag has no handle to withhold, so the
    // same rule has to be stated as configuration or the drag hotkey would
    // pick up a row the source refuses to move.
    canDrag: (items) => items.every((item) => !item.getItemData()?.readOnly),
    // Every rule about where a drop may land lives in `canDropOnTarget`, for
    // both the pointer and the keyboard. This stays a thin adapter from
    // headless-tree's target shape to that function's parameters.
    canDrop: (_items, target) =>
      canDropOnTarget({
        isFolder: target.item.isFolder(),
        orderReadOnly: target.item.getItemData()?.orderReadOnly,
        isOrderedTarget: isOrderedDragTarget(target),
        reorderAllowed,
        setChildOrderEnabled,
      }),
    indent: 16,
    seperateDragHandle: true,
    // `hotkeysCoreFeature` is what binds any key at all; `selectionFeature`
    // gives the arrow keys something to carry and supplies the multi-item
    // set the drag hotkey reads. `keyboardDragAndDropFeature` rides on the
    // same `canDrag`/`canDrop`/`onDrop` config as the pointer path, so it
    // stays gated behind the same capabilities.
    features: [
      asyncDataLoaderFeature,
      hotkeysCoreFeature,
      selectionFeature,
      ...(dragEnabled ? [dragAndDropFeature, keyboardDragAndDropFeature] : []),
      propMemoizationFeature,
    ],
    onTreeHotkey: showBookmarks
      ? undefined
      : (name) => skipHiddenRows(tree, name),
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

  const visibleItems = items.filter((item) => {
    if (item.getId() === BOOKMARK_ORGANIZER_ROOT_ID) return false
    if (!showBookmarks && !item.isFolder()) return false
    return true
  })

  // headless-tree hands `tabIndex: 0` to the focused row and -1 to every
  // other, treating the first row as focused while the state is still null.
  // That first row can be one "Folders Only" hides, or one a refresh has
  // since removed — either leaves the tree with no tab stop at all. Seeding
  // focus onto a row that is actually rendered is what keeps Tab able to
  // reach the tree, and where focus lands after a mutation.
  React.useEffect(() => {
    if (visibleItems.length === 0) return

    const focusedId = tree.getState().focusedItem
    if (focusedId && visibleItems.some((item) => item.getId() === focusedId)) {
      return
    }

    visibleItems[0].setFocused()
  }, [visibleItems, tree])

  if (visibleItems.length === 0) {
    return <BookmarkOrganizerEmpty createParentId={createParentId} />
  }

  return (
    <div
      {...tree.getContainerProps("Bookmark Organizer")}
      className="relative space-y-1"
    >
      {/* A keyboard drag has no drag image and no cursor to follow, so the
          only feedback a screen reader gets is this live region — the
          library's own, which names the position the next Enter would drop
          into. */}
      {dragEnabled && <AssistiveTreeDescription tree={tree} />}
      <div
        className="h-0.5 rounded-full bg-primary"
        style={tree.getDragLineStyle()}
      />
      {visibleItems.map((item) => (
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
  // `rootFolder` is the store's own resolution of `rootFolderId` against the
  // tree, so going through it means a saved id whose folder has since been
  // deleted falls back to the tree root instead of asking for a subtree that
  // no longer exists and rendering an empty organizer — which is what the
  // create actions and import already do.
  const effectiveRootNode = rootFolder ?? tree[0]
  const effectiveRootId = effectiveRootNode?.id ?? null

  if (!adapter) {
    return <BookmarkOrganizerUnavailable />
  }

  const setChildOrderEnabled =
    adapter.capabilities.setChildOrder &&
    adapter.bookmarks.setChildOrder !== undefined

  const createParentId = resolveCreateParentId(
    tree,
    rootFolderId,
    adapter.capabilities.rootIsCreatable ?? false
  )

  return (
    <BookmarkOrganizerTreeImpl
      ref={treeRef}
      effectiveRootId={effectiveRootId}
      createParentId={createParentId}
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
