import { useEffect } from "react"
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter"
import { extractClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index"
import { reorderArray } from "./move-operations"
import type { ListItemDragData } from "./use-sortable-list-item"

interface UseListDropMonitorOptions {
  /** Whether the monitor should be active */
  active: boolean
  /** The current ordered list of item IDs */
  orderedIds: string[]
  /** Called with the new order when a drop occurs */
  onReorder: (newOrder: string[]) => void
}

/**
 * Monitors for list-item drag-and-drop drops and calls onReorder with the new ID order.
 * Must be used inside a component that also uses useSortableListItem.
 */
export function useListDropMonitor({
  active,
  orderedIds,
  onReorder,
}: UseListDropMonitorOptions) {
  useEffect(() => {
    if (!active) return

    return monitorForElements({
      canMonitor: ({ source }) =>
        source.data.type === "list-item",
      onDrop({ source, location }) {
        const target = location.current.dropTargets[0]
        if (!target) return

        const sourceData = source.data as unknown as ListItemDragData
        const targetData = target.data as unknown as ListItemDragData
        if (targetData.type !== "list-item") return

        const closestEdge = extractClosestEdge(target.data)
        const destinationIndex = getReorderDestinationIndex({
          startIndex: sourceData.index,
          closestEdgeOfTarget: closestEdge,
          indexOfTarget: targetData.index,
          axis: "vertical",
        })

        if (destinationIndex === sourceData.index) return

        onReorder(reorderArray(orderedIds, sourceData.index, destinationIndex))
      },
    })
  }, [active, orderedIds, onReorder])
}
