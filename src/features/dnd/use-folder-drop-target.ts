import { useEffect, useRef, useState } from "react"
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { DND_TYPE, type BookmarkDragData } from "./types"

interface UseFolderDropTargetInput {
  folderId: string
  disabled?: boolean
}

/**
 * Makes a folder card a drop target for bookmark items.
 * Used to enable dropping bookmarks into a folder (especially empty ones).
 */
export function useFolderDropTarget({
  folderId,
  disabled = false,
}: UseFolderDropTargetInput) {
  const ref = useRef<HTMLElement | null>(null)
  const [isOver, setIsOver] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || disabled) return

    return dropTargetForElements({
      element: el,
      canDrop: ({ source }) => {
        const data = source.data as unknown as BookmarkDragData
        return data.type === DND_TYPE.BOOKMARK
      },
      getData: () => ({ type: "folder-drop-target", folderId }),
      onDragEnter: () => setIsOver(true),
      onDragLeave: () => setIsOver(false),
      onDrop: () => setIsOver(false),
    })
  }, [folderId, disabled])

  return { ref, isOver }
}
