import type { BookmarkNode } from "@/browser"

export interface RootFolderOption {
  id: string
  label: string
}

function collectFolderPaths(
  node: BookmarkNode,
  path: string[] = []
): RootFolderOption[] {
  const currentPath = node.title ? [...path, node.title] : path
  const result: RootFolderOption[] = []

  if (node.title) {
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
