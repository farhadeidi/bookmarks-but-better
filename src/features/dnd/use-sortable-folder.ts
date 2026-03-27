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
import { DND_TYPE, type FolderCardDragData } from "./types"

interface UseSortableFolderInput {
  id: string
  index: number
  disabled?: boolean
}

export function useSortableFolder({
  id,
  index,
  disabled = false,
}: UseSortableFolderInput) {
  const ref = useRef<HTMLElement | null>(null)
  const handleRef = useRef<HTMLElement | null>(null)
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
        type: DND_TYPE.FOLDER_CARD,
        id,
        index: indexRef.current,
      }) satisfies FolderCardDragData as unknown as Record<string, unknown>

    return combine(
      draggable({
        element: el,
        dragHandle: handleRef.current ?? undefined,
        getInitialData: getData,
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => {
          return (
            source.data.type === DND_TYPE.FOLDER_CARD && source.data.id !== id
          )
        },
        getData: ({ input, element }) =>
          attachClosestEdge(getData(), {
            element,
            input,
            allowedEdges: ["top", "bottom"],
          }),
        onDragEnter: ({ self }) =>
          setClosestEdge(extractClosestEdge(self.data)),
        onDrag: ({ self }) => setClosestEdge(extractClosestEdge(self.data)),
        onDragLeave: () => setClosestEdge(null),
        onDrop: () => setClosestEdge(null),
      })
    )
  }, [id, disabled])

  return { ref, handleRef, isDragging, closestEdge }
}
