import {
  BOOKMARK_ORGANIZER_ROOT_ID,
  type OrganizerItemData,
} from "./bookmark-organizer-types"

export { BOOKMARK_ORGANIZER_ROOT_ID } from "./bookmark-organizer-types"
export type { OrganizerItemData } from "./bookmark-organizer-types"

function isFolderNode(node: chrome.bookmarks.BookmarkTreeNode): boolean {
  return node.url == null
}

async function resolveFolderChildCount(
  node: chrome.bookmarks.BookmarkTreeNode
): Promise<number> {
  if (!isFolderNode(node)) {
    return 0
  }

  if (node.children) {
    return node.children.length
  }

  return chrome.bookmarks.getChildren(node.id).then((children) => children.length)
}

export function toOrganizerItem(
  node: chrome.bookmarks.BookmarkTreeNode,
  index: number,
  childCount?: number
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
    childCount:
      kind === "folder" ? childCount ?? node.children?.length ?? 0 : 0,
  }
}

export async function loadOrganizerChildren(
  parentId?: string | null
): Promise<OrganizerItemData[]> {
  if (!parentId || parentId === BOOKMARK_ORGANIZER_ROOT_ID) {
    return []
  }

  const children = await chrome.bookmarks.getChildren(parentId)
  return Promise.all(
    children.map(async (node, index) => {
      const childCount = await resolveFolderChildCount(node)
      return toOrganizerItem(node, index, childCount)
    })
  )
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

  const childCount = await resolveFolderChildCount(node)
  return toOrganizerItem(node, 0, childCount)
}
