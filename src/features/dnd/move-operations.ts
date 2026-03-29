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
export function reorderArray<T>(list: T[], startIndex: number, finishIndex: number): T[] {
  if (startIndex === finishIndex) return list
  const result = [...list]
  const [removed] = result.splice(startIndex, 1)
  result.splice(finishIndex, 0, removed)
  return result
}
