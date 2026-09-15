import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import {
  selectFolderDisplay,
  usePreferencesStore,
} from "@/stores/preferences-store"
import { BookmarkCard } from "@/features/bookmark-card"
import { useSortableFolder, DropIndicator } from "@/features/dnd"
import type { BookmarkNode } from "@/browser"
import { findBrowsePath, getDisplayRoot } from "@/lib/bookmark-utils"
import { cn } from "@/lib/utils"
import { getVisibleFolders } from "./folder-collection"
import {
  distributeToColumns,
  estimateCardHeight,
  useMeasuredCardHeights,
} from "./card-heights"
import { LazyCard } from "./lazy-card"
import { LazyCardsContext, shouldGateCards } from "./lazy-cards-gate"
import { BookmarkGridEmpty } from "./bookmark-grid-empty"
import { FolderBreadcrumb } from "./folder-breadcrumb"
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
  const browsedFolderId = useBookmarkStore((s) => s.browsedFolderId)
  // Either capability means the adapter can express an order, which is all a
  // folder-card drag needs — the card order itself is a client-local
  // preference, never written through an adapter.
  const canOrder = useBookmarkStore(
    (s) =>
      (s.adapter?.capabilities.reorder ?? true) ||
      (s.adapter?.capabilities.setChildOrder ?? false)
  )
  const folderDisplay = usePreferencesStore(selectFolderDisplay)
  const maxColumns = usePreferencesStore((s) => s.maxColumns)
  const containerMode = usePreferencesStore((s) => s.containerMode)
  const cardLayouts = usePreferencesStore((s) => s.cardLayouts)
  const folderOrder = usePreferencesStore((s) => s.folderOrder)
  const experimentalCardDrag =
    usePreferencesStore((s) => s.experimentalCardDrag) && canOrder

  const columnCount = useColumnCount(maxColumns)
  const baseRoot = getDisplayRoot(rootFolder, tree)

  // Only folder tiles open folders. The other displays keep drawing from the
  // root even while a folder opened earlier is still remembered.
  const browsePath = React.useMemo(
    () =>
      baseRoot && folderDisplay === "tiles"
        ? findBrowsePath(baseRoot, browsedFolderId)
        : null,
    [baseRoot, folderDisplay, browsedFolderId]
  )
  const openFolder = browsePath ? browsePath[browsePath.length - 1] : null
  const displayRoot = openFolder ?? baseRoot

  const folders = React.useMemo(() => {
    if (!displayRoot) return []

    return getVisibleFolders({
      displayRoot,
      folderDisplay,
      experimentalCardDrag,
      folderOrder,
      isTreeRoot: rootFolder === null && openFolder === null,
    })
  }, [
    displayRoot,
    folderDisplay,
    experimentalCardDrag,
    folderOrder,
    rootFolder,
    openFolder,
  ])

  const gateCards = React.useMemo(
    () => (displayRoot ? shouldGateCards(displayRoot) : false),
    [displayRoot]
  )

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
    folderDisplay,
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        Loading bookmarks...
      </div>
    )
  }

  if (folders.length === 0 && !browsePath) {
    return <BookmarkGridEmpty />
  }

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-col gap-4",
        containerMode === "contained" && "mx-auto max-w-[1440px]"
      )}
    >
      {browsePath && (
        // The source's own root has no name a person gave it, so the first
        // step reads the way the filter bar's root folder control does.
        <FolderBreadcrumb
          path={browsePath}
          rootLabel={rootFolder?.title ?? "All bookmarks"}
        />
      )}
      {folders.length === 0 ? (
        // An empty folder opened from a tile still needs the breadcrumb above
        // it: without one there would be no way back out.
        <BookmarkGridEmpty openFolder={openFolder} />
      ) : (
        <GridNavigationContext value={navigation}>
          <LazyCardsContext value={gateCards}>
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
                    // The lazy wrapper is what the ResizeObserver watches: it
                    // is the only element that exists in both the draggable
                    // and plain variants, and it is only measured while the
                    // card is real rather than a placeholder.
                    <LazyCard
                      key={folder.id}
                      folder={folder}
                      folderDisplay={folderDisplay}
                      estimatedHeight={estimateCardHeight(folder, cardLayouts)}
                      measureRef={measureRefs.get(folder.id)}
                    >
                      {experimentalCardDrag ? (
                        <SortableFolderCard
                          folder={folder}
                          sortableIndex={folderIndexMap.get(folder.id) ?? 0}
                        />
                      ) : (
                        <BookmarkCard folder={folder} />
                      )}
                    </LazyCard>
                  ))}
                </div>
              ))}
            </div>
          </LazyCardsContext>
        </GridNavigationContext>
      )}
    </div>
  )
}
