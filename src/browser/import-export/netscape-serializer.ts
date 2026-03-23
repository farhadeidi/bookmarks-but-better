import type { BookmarkNode } from "../types"

/**
 * Serializes a BookmarkNode tree to standard Netscape Bookmark HTML format.
 * This format is importable by all major browsers.
 */
export function serializeNetscapeBookmarks(tree: BookmarkNode[]): string {
  const lines: string[] = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file.",
    "     It will be read and overwritten.",
    "     DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
  ]

  function serializeNodes(nodes: BookmarkNode[], indent: number): void {
    const pad = "    ".repeat(indent)
    lines.push(`${pad}<DL><p>`)

    for (const node of nodes) {
      if (node.url) {
        // Bookmark link
        const addDate = node.dateAdded
          ? ` ADD_DATE="${Math.floor(node.dateAdded / 1000)}"`
          : ""
        lines.push(
          `${pad}    <DT><A HREF="${escapeHtml(node.url)}"${addDate}>${escapeHtml(node.title)}</A>`
        )
      } else if (node.children) {
        // Folder
        const addDate = node.dateAdded
          ? ` ADD_DATE="${Math.floor(node.dateAdded / 1000)}"`
          : ""
        lines.push(
          `${pad}    <DT><H3${addDate}>${escapeHtml(node.title)}</H3>`
        )
        serializeNodes(node.children, indent + 1)
      }
    }

    lines.push(`${pad}</DL><p>`)
  }

  // Start from root's children (skip the root node itself)
  const rootChildren =
    tree.length === 1 && tree[0].children ? tree[0].children : tree

  serializeNodes(rootChildren, 0)

  return lines.join("\n")
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
