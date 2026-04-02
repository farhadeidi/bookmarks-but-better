import type { BookmarkNode } from "@/browser"

export interface RootFolderOption {
  id: string
  label: string
}

const UNTITLED_FOLDER_LABEL = "Untitled Folder"

function collectFolderPaths(
  node: BookmarkNode,
  path: string[] = []
): RootFolderOption[] {
  const isRootLevelNode = path.length === 0 && !node.title
  const segment = node.title || UNTITLED_FOLDER_LABEL
  const currentPath = node.title || !isRootLevelNode ? [...path, segment] : path
  const result: RootFolderOption[] = []

  if (!isRootLevelNode) {
    result.push({
      id: node.id,
      label: currentPath.join(" > "),
    })
  }

  for (const child of node.children ?? []) {
    if (child.url === undefined) {
      result.push(...collectFolderPaths(child, currentPath))
    }
  }

  return result
}

export function buildRootFolderOptions(tree: BookmarkNode[]): RootFolderOption[] {
  const all: RootFolderOption[] = []

  for (const root of tree) {
    all.push(...collectFolderPaths(root))
  }

  return all
}
