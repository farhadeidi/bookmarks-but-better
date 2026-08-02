import type { BookmarkNode } from "@/browser"

export type ExportScope = "dashboard" | "everything"

function findNode(nodes: BookmarkNode[], id: string): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNode(node.children ?? [], id)
    if (found) return found
  }
  return null
}

/**
 * Picks the subtree an export should serialize.
 *
 * `"dashboard"` exports only what the dashboard actually shows, so that an
 * export round-trips back through import as the same set of bookmarks. It
 * degrades to the whole tree when no root folder is selected (nothing is being
 * scoped away) or when the saved root no longer exists — an export that
 * silently produces an empty file would be worse than an over-broad one.
 */
export function resolveExportTree(
  tree: BookmarkNode[],
  rootFolderId: string | null,
  scope: ExportScope
): BookmarkNode[] {
  if (scope === "everything" || !rootFolderId) return tree

  const root = findNode(tree, rootFolderId)
  return root ? [root] : tree
}

/** Filename for the downloaded file, kept free of path separators. */
export function exportFileName(
  scope: ExportScope,
  rootTitle: string | null
): string {
  if (scope === "everything" || !rootTitle) return "bookmarks.html"

  const slug = rootTitle
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")

  return slug ? `bookmarks-${slug}.html` : "bookmarks.html"
}
