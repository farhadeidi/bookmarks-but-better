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

  const folders = experimentalCardDrag
    ? sortFoldersByOrder(rawFolders, folderOrder)
    : rawFolders

  // The display root itself becomes a card, always first, whenever it holds
  // direct bookmarks — narrowing to a leaf folder (or one that mixes loose
  // bookmarks with subfolders) must not drop its own bookmarks. Its children
  // are trimmed to bookmarks only, so the card renders just those bookmarks
  // rather than re-drawing the subfolder cards the grid already lays out
  // (bookmark-card.tsx nests subfolders inline when Nested folders is on).
  // The id stays the root's real id, so keyboard navigation and lazy cards
  // key off the same identity as everywhere else the root is referenced.
  const rootBookmarks = (displayRoot.children ?? []).filter(
    (child) => child.url !== undefined
  )
  if (rootBookmarks.length === 0) return folders

  const rootCard: BookmarkNode = { ...displayRoot, children: rootBookmarks }
  return [rootCard, ...folders]
}
