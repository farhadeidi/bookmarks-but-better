import type { BookmarkNode } from "@/browser"
import { collectAllFolders } from "@/lib/bookmark-utils"
import { sortFoldersByOrder } from "@/features/dnd"

interface GetVisibleFoldersOptions {
  displayRoot: BookmarkNode
  nestedFolders: boolean
  experimentalCardDrag: boolean
  folderOrder: string[]
  /**
   * Whether `displayRoot` is the source's own top-level root (no Root folder
   * narrowing chosen), as opposed to a folder the user picked. The top-level
   * root's `title` is a synthetic, adapter-internal label — a Vault's name,
   * `"Standalone bookmarks"`, or empty for the browser root — never a folder
   * a person named, so a root card built from it is titled "Bookmarks"
   * instead of surfacing that internal label as if it were one.
   */
  isTreeRoot: boolean
}

export function getVisibleFolders({
  displayRoot,
  nestedFolders,
  experimentalCardDrag,
  folderOrder,
  isTreeRoot,
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

  const rootCard: BookmarkNode = {
    ...displayRoot,
    title: isTreeRoot ? "Bookmarks" : displayRoot.title,
    children: rootBookmarks,
  }
  return [rootCard, ...folders]
}
