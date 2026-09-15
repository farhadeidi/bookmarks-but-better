import type { BookmarkNode } from "@/browser"
import type { FolderDisplay } from "@/stores/preferences-store"
import { collectAllFolders } from "@/lib/bookmark-utils"
import { sortFoldersByOrder } from "@/features/dnd"

interface GetVisibleFoldersOptions {
  displayRoot: BookmarkNode
  folderDisplay: FolderDisplay
  experimentalCardDrag: boolean
  folderOrder: string[]
  /**
   * Whether `displayRoot` is the source's own top-level root (no Root folder
   * narrowing chosen, no folder opened from a folder tile), as opposed to a
   * folder the user picked. The top-level root's `title` is a synthetic,
   * adapter-internal label — a Vault's name, `"Standalone bookmarks"`, or
   * empty for the browser root — never a folder a person named, so a root
   * card built from it is titled "Bookmarks" instead of surfacing that
   * internal label as if it were one.
   */
  isTreeRoot: boolean
}

export function getVisibleFolders({
  displayRoot,
  folderDisplay,
  experimentalCardDrag,
  folderOrder,
  isTreeRoot,
}: GetVisibleFoldersOptions): BookmarkNode[] {
  // Nested folders and folder tiles both give each direct subfolder a card and
  // draw what lies below it inside that card; only the flat display lifts
  // every folder in the tree to a card of its own.
  const rawFolders =
    folderDisplay === "flat"
      ? collectAllFolders(displayRoot)
      : (displayRoot.children ?? []).filter(
          (child) => child.url === undefined && child.children !== undefined
        )

  const folders = experimentalCardDrag
    ? sortFoldersByOrder(rawFolders, folderOrder)
    : rawFolders

  // The display root itself becomes a card, always first, whenever it holds
  // direct bookmarks — narrowing to a leaf folder (or one that mixes loose
  // bookmarks with subfolders) must not drop its own bookmarks. Its children
  // are trimmed to bookmarks only, so the card renders just those bookmarks
  // rather than re-drawing the subfolder cards the grid already lays out
  // (bookmark-card.tsx draws subfolders inside a card when Nested folders or
  // Folder tiles is on). The id stays the root's real id, so keyboard
  // navigation and lazy cards key off the same identity as everywhere else
  // the root is referenced.
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
