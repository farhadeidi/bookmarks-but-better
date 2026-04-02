import {
  BOOKMARK_ORGANIZER_ROOT_ID,
  type OrganizerItemData,
} from "./bookmark-organizer-types"

export { BOOKMARK_ORGANIZER_ROOT_ID } from "./bookmark-organizer-types"
export type { OrganizerItemData } from "./bookmark-organizer-types"

export function toOrganizerItem(
  node: chrome.bookmarks.BookmarkTreeNode,
  index: number
): OrganizerItemData {
  const kind = node.children ? "folder" : "bookmark"

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
  parentId?: string | null
): Promise<OrganizerItemData[]> {
  if (!parentId || parentId === BOOKMARK_ORGANIZER_ROOT_ID) {
    return []
  }

  const children = await chrome.bookmarks.getChildren(parentId)
  return children.map((node, index) => toOrganizerItem(node, index))
}

export async function loadOrganizerItem(
  id?: string | null
): Promise<OrganizerItemData | null> {
  if (!id || id === BOOKMARK_ORGANIZER_ROOT_ID) {
    return null
  }

  const [node] = await chrome.bookmarks.get(id)
  if (!node) {
    return null
  }

  return toOrganizerItem(node, 0)
}
