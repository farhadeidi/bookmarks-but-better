import { useEffect } from "react"
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import {
  DND_TYPE,
  type BookmarkDragData,
  type FolderCardDragData,
} from "./types"
import {
  buildChildOrderForBookmarkReorder,
  reorderArray,
  sortFoldersByOrder,
} from "./move-operations"
import {
  collectAllFolders,
  findNodeById,
  getDisplayRoot,
} from "@/lib/bookmark-utils"

export function DndMonitor() {
  const moveBookmark = useBookmarkStore((s) => s.moveBookmark)
  const setChildOrder = useBookmarkStore((s) => s.setChildOrder)
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)
  const moveEnabled = useBookmarkStore(
    (s) => s.adapter?.capabilities.move ?? true
  )
  const reorderEnabled = useBookmarkStore(
    (s) => s.adapter?.capabilities.reorder ?? true
  )
  // Mirrors the organizer's check: the capability flag and the optional method
  // must agree before anything routes ordering through `setChildOrder`.
  const setChildOrderEnabled = useBookmarkStore(
    (s) =>
      (s.adapter?.capabilities.setChildOrder ?? false) &&
      s.adapter?.bookmarks.setChildOrder !== undefined
  )
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const folderOrder = usePreferencesStore((s) => s.folderOrder)
  const setFolderOrder = usePreferencesStore((s) => s.setFolderOrder)

  useEffect(() => {
    if (!moveEnabled && !reorderEnabled && !setChildOrderEnabled) return

    return monitorForElements({
      onDrop({ source, location }) {
        const target = location.current.dropTargets[0]
        if (!target) return

        const sourceData = source.data as unknown as
          | BookmarkDragData
          | FolderCardDragData

        if (sourceData.type === DND_TYPE.BOOKMARK) {
          handleBookmarkDrop(sourceData, target)
        } else if (sourceData.type === DND_TYPE.FOLDER_CARD) {
          handleFolderCardDrop(sourceData, target)
        }
      },
    })

    function handleBookmarkDrop(
      sourceData: BookmarkDragData,
      target: { data: Record<string, unknown> }
    ) {
      const targetData = target.data as Record<string, unknown>

      // Dropping onto a folder drop target (e.g., empty folder): a
      // cross-folder move, not a same-parent reorder.
      if (targetData.type === "folder-drop-target") {
        if (!moveEnabled) return
        const targetFolderId = targetData.folderId as string
        if (targetFolderId !== sourceData.folderId) {
          void moveBookmark(sourceData.id, {
            parentId: targetFolderId,
            index: 0,
          })
        }
        return
      }

      // Dropping onto another bookmark
      if (targetData.type !== DND_TYPE.BOOKMARK) return

      const targetBookmark = targetData as unknown as BookmarkDragData
      const closestEdge = extractClosestEdge(targetData)

      if (sourceData.folderId === targetBookmark.folderId) {
        // Same folder: a pure reorder. Two paths, chosen by capability and
        // never mixed — `reorder` means the adapter persists a position
        // through `move(id, {index})` (Chrome, Firefox, Standalone), while
        // `setChildOrder` means whole-folder ordering is the only way to say
        // it (daemon, whose `move()` has no notion of an index).
        if (!reorderEnabled && !setChildOrderEnabled) return

        if (reorderEnabled) {
          // The raw drag indices are deliberate here, and must stay. This path
          // ends in `move(id, {index})`, which addresses the node by id and
          // only positions it — so a stale index misplaces the bookmark the
          // user dragged. The daemon path below writes a whole permutation and
          // would instead move a *different* bookmark, which is why it alone
          // re-derives its positions. Misplacement and mistaken identity are
          // not the same bug, and hardening this branch would change extension
          // behaviour the brief requires kept exactly.
          const destinationIndex = getReorderDestinationIndex({
            startIndex: sourceData.index,
            closestEdgeOfTarget: closestEdge,
            indexOfTarget: targetBookmark.index,
            axis: "vertical",
          })

          if (destinationIndex === sourceData.index) return

          void moveBookmark(sourceData.id, {
            parentId: sourceData.folderId,
            index: destinationIndex,
          })
          return
        }

        // A card's drag positions count bookmarks only, so the folder's real
        // children are needed to turn them into the complete permutation
        // `setChildOrder` takes. Ids rather than the drag's indices: the
        // folder may have changed since the gesture began, and the whole
        // permutation is written in one request, so addressing the wrong row
        // would reorder a bookmark the user never touched. Resolving the two
        // positions against the live children — and refusing when either id
        // is gone — is what keeps the write bound to what was dragged.
        const folder = findNodeById(tree, sourceData.folderId)
        if (!folder) return

        const orderedChildIds = buildChildOrderForBookmarkReorder({
          children: folder.children ?? [],
          sourceId: sourceData.id,
          targetId: targetBookmark.id,
          closestEdge,
        })
        if (!orderedChildIds) return

        void setChildOrder(sourceData.folderId, orderedChildIds)
      } else {
        // Different folder: a cross-folder move. The destination index is
        // best-effort UI positioning only — adapters without `reorder`
        // (daemon) ignore it and place the node deterministically.
        if (!moveEnabled) return

        let destinationIndex = targetBookmark.index
        if (closestEdge === "bottom") {
          destinationIndex += 1
        }

        void moveBookmark(sourceData.id, {
          parentId: targetBookmark.folderId,
          index: destinationIndex,
        })
      }
    }

    function handleFolderCardDrop(
      sourceData: FolderCardDragData,
      target: { data: Record<string, unknown> }
    ) {
      // Folder cards only ever reorder among siblings — there's no
      // cross-folder move for them. Their order is a client-local preference
      // that never reaches an adapter (the flattened, non-nested view mixes
      // folders from different parents, so no vault could express it), but the
      // affordance still has to be gated on the adapter being able to order at
      // all — by either capability.
      if (!reorderEnabled && !setChildOrderEnabled) return

      const targetData = target.data as unknown as FolderCardDragData
      if (targetData.type !== DND_TYPE.FOLDER_CARD) return

      const closestEdge = extractClosestEdge(target.data)
      const destinationIndex = getReorderDestinationIndex({
        startIndex: sourceData.index,
        closestEdgeOfTarget: closestEdge,
        indexOfTarget: targetData.index,
        axis: "vertical",
      })

      if (destinationIndex === sourceData.index) return

      // Get the current effective folder list
      const displayRoot = getDisplayRoot(rootFolder, tree)
      if (!displayRoot) return

      const rawFolders = nestedFolders
        ? (displayRoot.children ?? []).filter(
            (c) => c.url === undefined && c.children !== undefined
          )
        : collectAllFolders(displayRoot)

      const sorted = sortFoldersByOrder(rawFolders, folderOrder)
      const currentIds = sorted.map((f) => f.id)
      const newOrder = reorderArray(
        currentIds,
        sourceData.index,
        destinationIndex
      )

      setFolderOrder(newOrder)
    }
  }, [
    moveBookmark,
    setChildOrder,
    rootFolder,
    tree,
    moveEnabled,
    reorderEnabled,
    setChildOrderEnabled,
    nestedFolders,
    folderOrder,
    setFolderOrder,
  ])

  return null
}
