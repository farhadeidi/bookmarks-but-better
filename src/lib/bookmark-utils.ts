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

export function getDisplayRoot(
  rootFolder: BookmarkNode | null,
  tree: BookmarkNode[]
): BookmarkNode | null {
  return rootFolder ?? (tree.length > 0 ? tree[0] : null)
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
