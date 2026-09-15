import type { BookmarkNode } from "@/browser"

export function collectAllFolders(node: BookmarkNode): BookmarkNode[] {
  const folders: BookmarkNode[] = []
  if (node.children) {
    for (const child of node.children) {
      if (child.url === undefined && child.children !== undefined) {
        folders.push(child)
        folders.push(...collectAllFolders(child))
      }
    }
  }
  return folders
}

/** Depth-first lookup of a node anywhere in a forest of trees. */
export function findNodeById(
  nodes: BookmarkNode[],
  id: string
): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNodeById(node.children, id)
      if (found) return found
    }
  }
  return null
}

/**
 * The chain of nodes from a root down to `id`, the node itself last, or
 * `null` when no tree holds it. Revealing an item needs the folders above it,
 * not just the item: each one has to be expanded before the next exists.
 */
export function findNodePath(
  nodes: BookmarkNode[],
  id: string
): BookmarkNode[] | null {
  for (const node of nodes) {
    if (node.id === id) return [node]
    const found = node.children ? findNodePath(node.children, id) : null
    if (found) return [node, ...found]
  }
  return null
}

export function getDisplayRoot(
  rootFolder: BookmarkNode | null,
  tree: BookmarkNode[]
): BookmarkNode | null {
  return rootFolder ?? (tree.length > 0 ? tree[0] : null)
}

/**
 * The folders from the display root down to the folder a folder tile opened,
 * both ends included, or `null` when nothing below the root is open. An id
 * that no longer names a folder under this root — deleted, moved out, left
 * over from another root — is nothing open rather than an error, so the
 * dashboard falls back to the root instead of drawing a stale folder.
 */
export function findBrowsePath(
  displayRoot: BookmarkNode,
  browsedFolderId: string | null
): BookmarkNode[] | null {
  if (browsedFolderId === null || browsedFolderId === displayRoot.id) {
    return null
  }
  const path = findNodePath([displayRoot], browsedFolderId)
  const folder = path?.[path.length - 1]
  if (!folder || folder.url !== undefined || folder.children === undefined) {
    return null
  }
  return path
}

export function describeReadOnly(node: {
  readOnly?: boolean
  diagnostics?: { detail: string }[]
}): string {
  const details = node.diagnostics?.map((d) => d.detail).filter(Boolean)
  if (details && details.length > 0) {
    return `Read-only: ${details.join(" ")}`
  }
  return "Read-only: this item can't be safely edited right now."
}

/**
 * Why a folder's child order is frozen. Deliberately separate from
 * `describeReadOnly`: the folder itself is perfectly editable — only the
 * positions of the things inside it are fixed.
 */
export function describeOrderReadOnly(node: {
  diagnostics?: { detail: string }[]
}): string {
  const details = node.diagnostics?.map((d) => d.detail).filter(Boolean)
  const lead = "Fixed order: items here can't be reordered."
  if (details && details.length > 0) {
    return `${lead} ${details.join(" ")}`
  }
  return `${lead} They can still be renamed, moved and deleted.`
}

export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  ms: number
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  return () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn()
    }, ms)
  }
}
