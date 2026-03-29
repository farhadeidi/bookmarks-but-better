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
import { reorderArray, sortFoldersByOrder } from "./move-operations"
import { collectAllFolders, getDisplayRoot } from "@/lib/bookmark-utils"

export function DndMonitor() {
  const moveBookmark = useBookmarkStore((s) => s.moveBookmark)
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const folderOrder = usePreferencesStore((s) => s.folderOrder)
  const setFolderOrder = usePreferencesStore((s) => s.setFolderOrder)

  useEffect(() => {
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

      // Dropping onto a folder drop target (e.g., empty folder)
      if (targetData.type === "folder-drop-target") {
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
        // Same folder: reorder
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
      } else {
        // Different folder: move
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
    rootFolder,
    tree,
    nestedFolders,
    folderOrder,
    setFolderOrder,
  ])

  return null
}
