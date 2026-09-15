import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowRight01Icon, Folder01Icon } from "@hugeicons/core-free-icons"
import { useFolderDropTarget } from "@/features/dnd"
// Past the grid's barrel on purpose, for the same reason as the card's.
import { useGridItem } from "@/features/bookmark-grid/use-grid-navigation"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BookmarkNode } from "@/browser"
import { cn } from "@/lib/utils"

/** Every bookmark anywhere below a folder, which is what its tile counts. */
function countBookmarks(folder: BookmarkNode): number {
  let count = 0
  for (const child of folder.children ?? []) {
    count += child.url !== undefined ? 1 : countBookmarks(child)
  }
  return count
}

/**
 * A subfolder drawn as one row that opens it, instead of its contents (the
 * Folder tiles display, #72).
 *
 * It is a `<button>`, so Enter and Space opening it are the browser's own —
 * the grid's key handler leaves them alone, as it does a bookmark row's link.
 * Dropping a bookmark on it moves the bookmark into that folder, exactly as
 * dropping on a card does.
 */
export const FolderTile = React.memo(function FolderTile({
  folder,
}: {
  folder: BookmarkNode
}) {
  const browseFolder = useBookmarkStore((s) => s.browseFolder)
  const moveEnabled = useBookmarkStore(
    (s) => s.adapter?.capabilities.move ?? true
  )
  const { ref: dropRef, isOver } = useFolderDropTarget({
    folderId: folder.id,
    disabled: !moveEnabled,
  })
  const { ref: gridRef, ...gridItem } = useGridItem(folder.id)

  const ref = React.useCallback(
    (element: HTMLButtonElement | null) => {
      dropRef.current = element
      gridRef(element)
    },
    [dropRef, gridRef]
  )

  const count = React.useMemo(() => countBookmarks(folder), [folder])

  return (
    <button
      type="button"
      ref={ref}
      {...gridItem}
      data-testid="folder-tile"
      aria-label={`${folder.title}, ${count} ${count === 1 ? "bookmark" : "bookmarks"}`}
      onClick={() => browseFolder(folder.id)}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-lg border border-transparent px-2 py-2.5 text-left transition-colors outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:py-1.5",
        isOver && "bg-accent ring-2 ring-primary/50"
      )}
    >
      <HugeiconsIcon
        icon={Folder01Icon}
        size={16}
        className="shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-base sm:text-sm">
        {folder.title}
      </span>
      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {count}
      </span>
      <HugeiconsIcon
        icon={ArrowRight01Icon}
        size={14}
        className="shrink-0 text-muted-foreground/60"
      />
    </button>
  )
})
