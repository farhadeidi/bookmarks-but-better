import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkCard } from "@/features/bookmark-card"
import { useSortableFolder, DropIndicator } from "@/features/dnd"
import type { BookmarkNode } from "@/browser"
import { cn } from "@/lib/utils"
import { getVisibleFolders } from "./folder-collection"
import { distributeToColumns, useMeasuredCardHeights } from "./card-heights"
import { BookmarkGridEmpty } from "./bookmark-grid-empty"
import { GridNavigationContext, useGridNavigation } from "./use-grid-navigation"

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
  // Either capability means the adapter can express an order, which is all a
  // folder-card drag needs — the card order itself is a client-local
  // preference, never written through an adapter.
  const canOrder = useBookmarkStore(
    (s) =>
      (s.adapter?.capabilities.reorder ?? true) ||
      (s.adapter?.capabilities.setChildOrder ?? false)
  )
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const maxColumns = usePreferencesStore((s) => s.maxColumns)
  const containerMode = usePreferencesStore((s) => s.containerMode)
  const cardLayouts = usePreferencesStore((s) => s.cardLayouts)
  const folderOrder = usePreferencesStore((s) => s.folderOrder)
  const experimentalCardDrag =
    usePreferencesStore((s) => s.experimentalCardDrag) && canOrder

  const columnCount = useColumnCount(maxColumns)
  const displayRoot = rootFolder ?? (tree.length > 0 ? tree[0] : null)

  const folders = React.useMemo(() => {
    if (!displayRoot) return []

    return getVisibleFolders({
      displayRoot,
      nestedFolders,
      experimentalCardDrag,
      folderOrder,
    })
  }, [displayRoot, nestedFolders, experimentalCardDrag, folderOrder])

  const folderIndexMap = React.useMemo(() => {
    const map = new Map<string, number>()
    folders.forEach((f, i) => map.set(f.id, i))
    return map
  }, [folders])

  const { heights, measureRefs } = useMeasuredCardHeights(
    folders,
    columnCount,
    cardLayouts
  )

  const columns = React.useMemo(
    () => distributeToColumns(folders, columnCount, cardLayouts, heights),
    [folders, columnCount, cardLayouts, heights]
  )

  // The grid is one composite widget: `columns` is the visual order the arrow
  // keys travel, so the keyboard model is derived from the same distribution
  // the layout is.
  const { navigation, containerProps } = useGridNavigation({
    columns,
    nestedFolders,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        Loading bookmarks...
      </div>
    )
  }

  if (folders.length === 0) {
    return <BookmarkGridEmpty />
  }

  return (
    <div
      className={cn(
        "w-full min-w-0",
        containerMode === "contained" && "mx-auto max-w-[1440px]"
      )}
    >
      <GridNavigationContext value={navigation}>
        <div
          {...containerProps}
          className="grid w-full min-w-0 items-start gap-4"
          style={{
            gridTemplateColumns: `repeat(${columnCount}, minmax(0, 1fr))`,
          }}
        >
          {columns.map((columnFolders, colIndex) => (
            <div key={colIndex} className="flex min-w-0 flex-col gap-4">
              {columnFolders.map((folder) => (
                // The wrapper is what the ResizeObserver watches: it is the
                // only element that exists in both the draggable and plain
                // variants.
                <div
                  key={folder.id}
                  ref={measureRefs.get(folder.id)}
                  className="min-w-0"
                >
                  {experimentalCardDrag ? (
                    <SortableFolderCard
                      folder={folder}
                      sortableIndex={folderIndexMap.get(folder.id) ?? 0}
                    />
                  ) : (
                    <BookmarkCard folder={folder} />
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </GridNavigationContext>
    </div>
  )
}
