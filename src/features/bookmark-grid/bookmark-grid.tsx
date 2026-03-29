import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkCard } from "@/features/bookmark-card"
import {
  useSortableFolder,
  sortFoldersByOrder,
  DropIndicator,
} from "@/features/dnd"
import type { BookmarkNode } from "@/browser"
import { cn } from "@/lib/utils"
import { collectAllFolders } from "@/lib/bookmark-utils"

function getColumnCountForWidth(): number {
  const w = window.innerWidth
  if (w >= 1536) return 6
  if (w >= 1280) return 5
  if (w >= 1024) return 4
  if (w >= 768) return 3
  if (w >= 640) return 2
  return 1
}

function useColumnCount(maxColumns: number): number {
  const [columnCount, setColumnCount] = React.useState(() =>
    Math.min(getColumnCountForWidth(), maxColumns)
  )

  React.useEffect(() => {
    const breakpoints = [640, 768, 1024, 1280, 1536]
    const queries = breakpoints.map((bp) =>
      window.matchMedia(`(min-width: ${bp}px)`)
    )

    function update() {
      setColumnCount(Math.min(getColumnCountForWidth(), maxColumns))
    }

    update()
    for (const q of queries) q.addEventListener("change", update)
    return () => {
      for (const q of queries) q.removeEventListener("change", update)
    }
  }, [maxColumns])

  return columnCount
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

function SortableFolderCard({
  folder,
  sortableIndex,
}: {
  folder: BookmarkNode
  sortableIndex: number
}) {
  const { ref, handleRef, isDragging, closestEdge } = useSortableFolder({
    id: folder.id,
    index: sortableIndex,
  })

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={cn("relative", isDragging && "opacity-40")}
    >
      <BookmarkCard folder={folder} dragHandleRef={handleRef} />
      <DropIndicator edge={closestEdge} />
    </div>
  )
}

export function BookmarkGrid() {
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)
  const isLoading = useBookmarkStore((s) => s.isLoading)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const maxColumns = usePreferencesStore((s) => s.maxColumns)
  const containerMode = usePreferencesStore((s) => s.containerMode)
  const cardLayouts = usePreferencesStore((s) => s.cardLayouts)
  const folderOrder = usePreferencesStore((s) => s.folderOrder)
  const experimentalCardDrag = usePreferencesStore(
    (s) => s.experimentalCardDrag
  )

  const columnCount = useColumnCount(maxColumns)
  const displayRoot = rootFolder ?? (tree.length > 0 ? tree[0] : null)

  const folders = React.useMemo(() => {
    if (!displayRoot) return []

    let rawFolders: BookmarkNode[]
    if (nestedFolders) {
      rawFolders = (displayRoot.children ?? []).filter(
        (c) => c.url === undefined && c.children !== undefined
      )
    } else {
      rawFolders = collectAllFolders(displayRoot)
    }

    return sortFoldersByOrder(rawFolders, folderOrder)
  }, [displayRoot, nestedFolders, folderOrder])

  const folderIndexMap = React.useMemo(() => {
    const map = new Map<string, number>()
    folders.forEach((f, i) => map.set(f.id, i))
    return map
  }, [folders])

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
        style={{
          gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
        }}
      >
        {columns.map((columnFolders, colIndex) => (
          <div key={colIndex} className="flex flex-col gap-4">
            {columnFolders.map((folder) =>
              experimentalCardDrag ? (
                <SortableFolderCard
                  key={folder.id}
                  folder={folder}
                  sortableIndex={folderIndexMap.get(folder.id) ?? 0}
                />
              ) : (
                <BookmarkCard key={folder.id} folder={folder} />
              )
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
