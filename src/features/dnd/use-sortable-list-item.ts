import { useEffect, useRef, useState } from "react"
import { draggable, dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine"
import { attachClosestEdge, extractClosestEdge, type Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"

const DND_TYPE_LIST_ITEM = "list-item" as const

export interface ListItemDragData {
  type: typeof DND_TYPE_LIST_ITEM
  id: string
  index: number
}

interface UseSortableListItemInput {
  id: string
  index: number
  disabled?: boolean
}

export function useSortableListItem({
  id,
  index,
  disabled = false,
}: UseSortableListItemInput) {
  const ref = useRef<HTMLElement | null>(null)
  const handleRef = useRef<HTMLElement | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [closestEdge, setClosestEdge] = useState<Edge | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || disabled) return

    const data: ListItemDragData = { type: DND_TYPE_LIST_ITEM, id, index }

    return combine(
      draggable({
        element: el,
        dragHandle: handleRef.current ?? undefined,
        getInitialData: () => data as unknown as Record<string, unknown>,
        onDragStart: () => setIsDragging(true),
        onDrop: () => setIsDragging(false),
      }),
      dropTargetForElements({
        element: el,
        canDrop: ({ source }) => {
          return (
            (source.data as ListItemDragData).type === DND_TYPE_LIST_ITEM &&
            source.data.id !== id
          )
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
  }, [id, index, disabled])

  return { ref, handleRef, isDragging, closestEdge }
}
