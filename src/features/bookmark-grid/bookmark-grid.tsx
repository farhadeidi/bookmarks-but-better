import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkCard } from "@/features/bookmark-card"
import type { BookmarkNode } from "@/browser"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"

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

function useColumnCount(maxColumns: number): number {
  const sm = useMediaQuery("(min-width: 640px)")
  const md = useMediaQuery("(min-width: 768px)")
  const lg = useMediaQuery("(min-width: 1024px)")
  const xl = useMediaQuery("(min-width: 1280px)")
  const xxl = useMediaQuery("(min-width: 1536px)")

  let count = 1
  if (sm) count = 2
  if (md) count = 3
  if (lg) count = 4
  if (xl) count = 5
  if (xxl) count = 6

  return Math.min(count, maxColumns)
}

/** Estimate card height based on layout mode and bookmark count */
function estimateCardHeight(
  folder: BookmarkNode,
  cardLayouts: Record<string, string>
): number {
  const bookmarks = (folder.children ?? []).filter((c) => c.url !== undefined)
  const count = bookmarks.length
  const layout = cardLayouts[folder.id] ?? "list"

  // Header (~40px) + padding (~24px)
  const chrome = 64

  if (layout === "grid") {
    // Grid: ~48px cells, ~5 per row in a typical column width, ~52px per row
    const cols = 5
    const rows = Math.ceil(count / cols)
    return chrome + rows * 52
  }

  // List: ~32px per item
  return chrome + count * 32
}

/** Distribute folders into the shortest column based on estimated height */
function distributeToColumns(
  folders: BookmarkNode[],
  columnCount: number,
  cardLayouts: Record<string, string>
): BookmarkNode[][] {
  const columns: BookmarkNode[][] = Array.from(
    { length: columnCount },
    () => []
  )
  const heights = new Array(columnCount).fill(0)

  for (const folder of folders) {
    const estimatedHeight = estimateCardHeight(folder, cardLayouts)

    // Find the shortest column
    let shortest = 0
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < heights[shortest]) shortest = i
    }

    columns[shortest].push(folder)
    // Add card height + gap between cards (16px)
    heights[shortest] += estimatedHeight + 16
  }

  return columns
}

export function BookmarkGrid() {
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)
  const isLoading = useBookmarkStore((s) => s.isLoading)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const maxColumns = usePreferencesStore((s) => s.maxColumns)
  const containerMode = usePreferencesStore((s) => s.containerMode)
  const cardLayouts = usePreferencesStore((s) => s.cardLayouts)

  const columnCount = useColumnCount(maxColumns)
  const displayRoot = rootFolder ?? (tree.length > 0 ? tree[0] : null)

  const folders = React.useMemo(() => {
    if (!displayRoot) return []

    if (nestedFolders) {
      return (displayRoot.children ?? []).filter(
        (c) => c.url === undefined && c.children !== undefined
      )
    }

    return collectAllFolders(displayRoot)
  }, [displayRoot, nestedFolders])

  const columns = React.useMemo(
    () => distributeToColumns(folders, columnCount, cardLayouts),
    [folders, columnCount, cardLayouts]
  )

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
      className={cn(containerMode === "contained" && "mx-auto max-w-[1440px]")}
    >
      <div
        className="grid items-start gap-4"
        style={{ gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))` }}
      >
        {columns.map((columnFolders, colIndex) => (
          <div key={colIndex} className="flex flex-col gap-4">
            {columnFolders.map((folder) => (
              <BookmarkCard key={folder.id} folder={folder} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
