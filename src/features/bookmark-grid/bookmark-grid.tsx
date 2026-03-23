import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkCard } from "@/features/bookmark-card"
import type { BookmarkNode } from "@/browser"

function collectAllFolders(node: BookmarkNode): BookmarkNode[] {
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

export function BookmarkGrid() {
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)
  const isLoading = useBookmarkStore((s) => s.isLoading)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)

  const displayRoot = rootFolder ?? (tree.length > 0 ? tree[0] : null)

  const folders = React.useMemo(() => {
    if (!displayRoot) return []

    if (nestedFolders) {
      // Only direct child folders
      return (displayRoot.children ?? []).filter(
        (c) => c.url === undefined && c.children !== undefined
      )
    }

    // Flat mode: all folders at any depth
    return collectAllFolders(displayRoot)
  }, [displayRoot, nestedFolders])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        Loading bookmarks...
      </div>
    )
  }

  if (folders.length === 0) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        No bookmark folders found.
      </div>
    )
  }

  return (
    <div
      className="columns-1 gap-4 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5"
      style={{ columnFill: "balance" }}
    >
      {folders.map((folder) => (
        <div key={folder.id} className="mb-4 break-inside-avoid">
          <BookmarkCard folder={folder} />
        </div>
      ))}
    </div>
  )
}
