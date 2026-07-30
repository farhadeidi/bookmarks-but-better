import { getReorderDestinationIndex } from "@atlaskit/pragmatic-drag-and-drop-hitbox/util/get-reorder-destination-index"
import type { Edge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge"
import type { BookmarkNode } from "@/browser"

/**
 * Sort folders according to a folderOrder array.
 * Folders in the order come first; remaining folders keep their original order.
 */
export function sortFoldersByOrder(
  folders: BookmarkNode[],
  folderOrder: string[]
): BookmarkNode[] {
  if (folderOrder.length === 0) return folders

  const orderMap = new Map(folderOrder.map((id, i) => [id, i]))
  const ordered: BookmarkNode[] = []
  const unordered: BookmarkNode[] = []

  for (const folder of folders) {
    if (orderMap.has(folder.id)) {
      ordered.push(folder)
    } else {
      unordered.push(folder)
    }
  }

  ordered.sort((a, b) => orderMap.get(a.id)! - orderMap.get(b.id)!)
  return [...ordered, ...unordered]
}

/**
 * Reorder an item in an array from one index to another.
 * Returns a new array.
 */
export function reorderArray<T>(
  list: T[],
  startIndex: number,
  finishIndex: number
): T[] {
  if (startIndex === finishIndex) return list
  const result = [...list]
  const [removed] = result.splice(startIndex, 1)
  result.splice(finishIndex, 0, removed)
  return result
}

/**
 * Rebuilds a folder's *whole* child order after one of its bookmarks was
 * dragged within a grid card.
 *
 * Deliberately takes the dragged and target **ids**, not the indices the drag
 * carries. A drag's indices are a snapshot of what the card rendered when the
 * gesture began, but the folder can change underneath it — an SSE event, a
 * refresh, another tab — and by drop time those numbers may address entirely
 * different bookmarks. Both positions are therefore re-derived from the live
 * children, and the destination is computed from *those*, so the permutation
 * always describes the two bookmarks the user actually dragged between.
 *
 * A card renders only the folder's direct bookmarks, so positions here are
 * relative to that filtered list — while `setChildOrder` takes every child,
 * bookmarks and sub-folders together. Sub-folders therefore keep the absolute
 * positions they already hold and only the bookmark subsequence is permuted:
 * the card can't express a position for a sub-folder, so it must not silently
 * claim one.
 *
 * Returns `null` when there is nothing honest to write — either id no longer
 * among the folder's bookmarks (deleted, reparented, or turned into something
 * else mid-drag), or a permutation identical to the current order. An absent
 * id is not recoverable by guessing: there is no position to infer, and
 * inventing one would write a permutation the user never asked for.
 */
export function buildChildOrderForBookmarkReorder(params: {
  children: BookmarkNode[]
  sourceId: string
  targetId: string
  closestEdge: Edge | null
}): string[] | null {
  const { children, sourceId, targetId, closestEdge } = params

  const bookmarkIds = children
    .filter((child) => child.url !== undefined)
    .map((child) => child.id)

  // A damaged vault can list one id twice. `indexOf` takes the first
  // occurrence, and the daemon adapter's own dedupe keeps the first occurrence
  // too, so the two agree — but by coincidence, not by contract. Neither reads
  // the other's rule, so a change to either must re-check this.
  const startIndex = bookmarkIds.indexOf(sourceId)
  const indexOfTarget = bookmarkIds.indexOf(targetId)
  if (startIndex === -1 || indexOfTarget === -1) return null

  const finishIndex = getReorderDestinationIndex({
    startIndex,
    closestEdgeOfTarget: closestEdge,
    indexOfTarget,
    axis: "vertical",
  })

  if (finishIndex === startIndex) return null

  const reordered = reorderArray(bookmarkIds, startIndex, finishIndex)

  let next = 0
  return children.map((child) =>
    child.url !== undefined ? reordered[next++] : child.id
  )
}
