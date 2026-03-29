import { useEffect, useRef, useState } from "react"
import {
  draggable,
  dropTargetForElements,
} from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import {
  attachClosestEdge,
  extractClosestEdge,
  type Edge,
} from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import { DND_TYPE, type BookmarkDragData } from "./types"

interface UseSortableBookmarkInput {
  id: string
  index: number
  folderId: string
  layout?: "list" | "grid"
  disabled?: boolean
}

export function useSortableBookmark({
  id,
  index,
  folderId,
  layout = "list",
  disabled = false,
}: UseSortableBookmarkInput) {
  const ref = useRef<HTMLElement | null>(null)
  const indexRef = useRef(index)
  const [isDragging, setIsDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    indexRef.current = index
  })

  useEffect(() => {
    const el = ref.current
    if (!el || disabled) return

    const getData = () =>
      ({
        type: DND_TYPE.BOOKMARK,
        id,
        folderId,
        index: indexRef.current,
      }) satisfies BookmarkDragData as unknown as Record<string, unknown>
    const allowedEdges: Edge[] =
      layout === "grid" ? ["left"] : ["top", "bottom"]

    return combine(
      draggable({
        element: el,
        getInitialData: getData,
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => {
          return source.data.type === DND_TYPE.BOOKMARK && source.data.id !== id
        },
        getData: ({ input, element }) =>
          attachClosestEdge(getData(), {
            element,
            input,
            allowedEdges,
          }),
        onDragEnter: ({ self }) =>
          setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      })
    )
  }, [id, folderId, layout, disabled])

  return { ref, isDragging, closestEdge }
}
