import { useEffect, useRef, useState } from "react"
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import { attachClosestEdge, extractClosestEdge, type Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import { DND_TYPE, type BookmarkDragData } from "./types"

interface UseSortableBookmarkInput {
  id: string
  index: number
  folderId: string
  disabled?: boolean
}

export function useSortableBookmark({
  id,
  index,
  folderId,
  disabled = false,
}: UseSortableBookmarkInput) {
  const ref = useRef<HTMLElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || disabled) return

    const data = { type: DND_TYPE.BOOKMARK, id, folderId, index } satisfies BookmarkDragData

    return combine(
      draggable({
        element: el,
        getInitialData: () => data as unknown as Record<string, unknown>,
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => {
          return source.data.type === DND_TYPE.BOOKMARK && source.data.id !== id
        },
        getData: ({ input, element }) =>
          attachClosestEdge(data as unknown as Record<string, unknown>, {
            element,
            input,
            allowedEdges: ["top", "bottom"],
          }),
        onDragEnter: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      })
    )
  }, [id, index, folderId, disabled])

  return { ref, isDragging, closestEdge }
}
