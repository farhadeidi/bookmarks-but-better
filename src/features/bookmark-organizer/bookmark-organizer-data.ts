import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import {
  BOOKMARK_ORGANIZER_ROOT_ID,
  type OrganizerItemData,
} from "./bookmark-organizer-types"

export { BOOKMARK_ORGANIZER_ROOT_ID } from "./bookmark-organizer-types"
export type { OrganizerItemData } from "./bookmark-organizer-types"

function isFolderNode(node: BookmarkNode): boolean {
  return node.url == null
}

export function toOrganizerItem(
  node: BookmarkNode,
  index: number
): OrganizerItemData {
  const kind = isFolderNode(node) ? "folder" : "bookmark"

  return {
    id: node.id,
    title:
      node.title ||
      (kind === "folder" ? "Untitled Folder" : "Untitled Bookmark"),
    kind,
    parentId: node.parentId ?? null,
    index,
    childCount: kind === "folder" ? node.children?.length ?? 0 : 0,
  }
}

export async function loadOrganizerChildren(
  bookmarks: Pick<BookmarkAdapter, "getSubTree">,
  parentId?: string | null
): Promise<OrganizerItemData[]> {
  if (!parentId || parentId === BOOKMARK_ORGANIZER_ROOT_ID) {
    return []
  }

  const [parent] = await bookmarks.getSubTree(parentId)
  return (parent?.children ?? []).map((node, index) => toOrganizerItem(node, index))
}

export async function loadOrganizerItem(
  bookmarks: Pick<BookmarkAdapter, "getSubTree">,
  id?: string | null
): Promise<OrganizerItemData | null> {
  if (!id || id === BOOKMARK_ORGANIZER_ROOT_ID) {
    return null
  }

  const [node] = await bookmarks.getSubTree(id)
  if (!node) {
    return null
  }

  return toOrganizerItem(node, 0)
}
