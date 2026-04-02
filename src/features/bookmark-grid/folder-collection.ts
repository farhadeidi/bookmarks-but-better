import type { BookmarkNode } from "@/browser"
import { collectAllFolders } from "@/lib/bookmark-utils"
import { sortFoldersByOrder } from "@/features/dnd"

interface GetVisibleFoldersOptions {
  displayRoot: BookmarkNode
  nestedFolders: boolean
  experimentalCardDrag: boolean
  folderOrder: string[]
}

export function getVisibleFolders({
  displayRoot,
  nestedFolders,
  experimentalCardDrag,
  folderOrder,
}: GetVisibleFoldersOptions): BookmarkNode[] {
  const rawFolders = nestedFolders
    ? (displayRoot.children ?? []).filter(
        (child) => child.url === undefined && child.children !== undefined
      )
    : collectAllFolders(displayRoot)

  return experimentalCardDrag
    ? sortFoldersByOrder(rawFolders, folderOrder)
    : rawFolders
}
