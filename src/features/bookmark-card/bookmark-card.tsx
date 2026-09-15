import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  GridViewIcon,
  Menu02Icon,
  MoreVerticalIcon,
  Folder01Icon,
  Bookmark02Icon,
  PencilEdit01Icon,
  Delete02Icon,
  ArrowUpRight01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons"
import { BookmarkItem } from "@/features/bookmark-item"
import { useFolderDropTarget } from "@/features/dnd"
// Past the grid's barrel on purpose: importing it would pull `BookmarkGrid`,
// which renders this card, back into the card's own module graph.
import { useGridItem } from "@/features/bookmark-grid/use-grid-navigation"
import { LazyCard } from "@/features/bookmark-grid/lazy-card"
import { estimateCardHeight } from "@/features/bookmark-grid/card-heights"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import type { BookmarkNode } from "@/browser"
import { describeReadOnly } from "@/lib/bookmark-utils"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"

interface FolderMenuProps {
  folder: BookmarkNode
  childCount: number
  layout: "list" | "grid"
  onToggleLayout: () => void
}

const FolderMenu = React.memo(function FolderMenu({
  folder,
  childCount,
  layout,
  onToggleLayout,
}: FolderMenuProps) {
  const adapter = useBookmarkStore((s) => s.adapter)
  const openEditor = useUIStore((s) => s.openEditor)
  const openDeleteConfirm = useUIStore((s) => s.openDeleteConfirm)
  const openBookmarkOrganizer = useUIStore((s) => s.openBookmarkOrganizer)
  const openCreateItem = useUIStore((s) => s.openCreateItem)

  const canOpenInManager = adapter?.capabilities.openInManager ?? false
  const isReadOnly = folder.readOnly ?? false

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Folder actions" />
        }
      >
        <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuItem onClick={onToggleLayout}>
          <HugeiconsIcon
            icon={layout === "list" ? GridViewIcon : Menu02Icon}
            size={14}
          />
          {layout === "list" ? "Grid view" : "List view"}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() =>
            openCreateItem({ type: "bookmark", parentId: folder.id })
          }
        >
          <HugeiconsIcon icon={Bookmark02Icon} size={14} />
          New Bookmark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={openBookmarkOrganizer}>
          <HugeiconsIcon icon={Folder01Icon} size={14} />
          Organize bookmarks
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isReadOnly ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuItem
                  aria-disabled="true"
                  className="opacity-50"
                  onClick={(e) => e.preventDefault()}
                  aria-label={`Rename (${describeReadOnly(folder)})`}
                />
              }
            >
              <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
              Rename
            </TooltipTrigger>
            <TooltipContent>{describeReadOnly(folder)}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuItem onClick={() => openEditor(folder)}>
            <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
            Rename
          </DropdownMenuItem>
        )}
        {canOpenInManager && (
          <DropdownMenuItem
            onClick={() => adapter?.bookmarks.openInManager(folder.id)}
          >
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
            View in manager
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {isReadOnly ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuItem
                  variant="destructive"
                  aria-disabled="true"
                  className="opacity-50"
                  onClick={(e) => e.preventDefault()}
                  aria-label={`Delete (${describeReadOnly(folder)})`}
                />
              }
            >
              <HugeiconsIcon icon={Delete02Icon} size={14} />
              Delete
            </TooltipTrigger>
            <TooltipContent>{describeReadOnly(folder)}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuItem
            variant="destructive"
            onClick={() =>
              openDeleteConfirm({
                id: folder.id,
                title: folder.title,
                type: "folder",
                childCount,
              })
            }
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
            Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

interface BookmarkCardProps {
  folder: BookmarkNode
  nested?: boolean
  dragHandleRef?: React.RefObject<HTMLElement | null>
}

/**
 * The bookmarks a card holds: its own, plus — in nested mode, where its
 * sub-folder cards are drawn inside it — every bookmark below it.
 */
function countBookmarks(folder: BookmarkNode, deep: boolean): number {
  let count = 0
  for (const child of folder.children ?? []) {
    if (child.url !== undefined) count += 1
    else if (deep) count += countBookmarks(child, deep)
  }
  return count
}

export const BookmarkCard = React.memo(function BookmarkCard({
  folder,
  nested = false,
  dragHandleRef,
}: BookmarkCardProps) {
  const layout = usePreferencesStore((s) => s.cardLayouts[folder.id] ?? "list")
  const cardLayouts = usePreferencesStore((s) => s.cardLayouts)
  const setCardLayout = usePreferencesStore((s) => s.setCardLayout)
  const isCollapsed = usePreferencesStore(
    (s) => s.collapsedFolders[folder.id] ?? false
  )
  const collapsedFolders = usePreferencesStore((s) => s.collapsedFolders)
  const setFolderCollapsed = usePreferencesStore((s) => s.setFolderCollapsed)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const adapter = useBookmarkStore((s) => s.adapter)
  // Dropping a bookmark onto a folder card moves it there (cross-folder),
  // which the daemon allows — this isn't a same-parent reorder.
  const moveEnabled = adapter?.capabilities.move ?? true

  const { ref: dropRef, isOver } = useFolderDropTarget({
    folderId: folder.id,
    disabled: !moveEnabled,
  })

  // The card's stop in the grid's roving tab order. The heading carries it
  // rather than the card: it is the one element that exists whatever the
  // card holds, and it already names the folder.
  const gridItem = useGridItem(folder.id)
  const bodyId = React.useId()

  const children = folder.children ?? []

  // Separate direct bookmarks from subfolders
  const bookmarks = children.filter((c) => c.url !== undefined)
  const subfolders = children.filter(
    (c) => c.url === undefined && c.children !== undefined
  )

  const toggleLayout = React.useCallback(() => {
    setCardLayout(folder.id, layout === "list" ? "grid" : "list")
  }, [folder.id, layout, setCardLayout])

  const toggleCollapsed = React.useCallback(() => {
    setFolderCollapsed(folder.id, !isCollapsed)
  }, [folder.id, isCollapsed, setFolderCollapsed])

  const { onKeyDown: onGridKeyDown } = gridItem
  const onHeadingKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) => {
      const plain =
        !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
      if (event.key === "Enter" && plain) {
        event.preventDefault()
        toggleCollapsed()
        return
      }
      onGridKeyDown(event)
    },
    [onGridKeyDown, toggleCollapsed]
  )

  const bookmarkCount = isCollapsed ? countBookmarks(folder, nestedFolders) : 0

  return (
    <div
      ref={dropRef as React.RefObject<HTMLDivElement>}
      data-testid="bookmark-card"
      className={cn(
        "flex w-full min-w-0 flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow",
        nested && "ring-border/50",
        isOver && "shadow-md ring-2 ring-primary/50"
      )}
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        {dragHandleRef && (
          <button
            ref={dragHandleRef as React.RefObject<HTMLButtonElement>}
            className="flex-shrink-0 cursor-grab touch-none text-muted-foreground/40 transition-colors hover:text-muted-foreground"
            aria-label="Drag to reorder folder"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="5" cy="3" r="1.5" />
              <circle cx="11" cy="3" r="1.5" />
              <circle cx="5" cy="8" r="1.5" />
              <circle cx="11" cy="8" r="1.5" />
              <circle cx="5" cy="13" r="1.5" />
              <circle cx="11" cy="13" r="1.5" />
            </svg>
          </button>
        )}
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={isCollapsed ? "Expand folder" : "Collapse folder"}
          aria-expanded={!isCollapsed}
          aria-controls={isCollapsed ? undefined : bodyId}
          className="-mx-1 flex-shrink-0 text-muted-foreground"
          onClick={toggleCollapsed}
        >
          <HugeiconsIcon
            icon={ArrowRight01Icon}
            size={12}
            style={{
              transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)",
              transition: "transform 120ms ease",
            }}
          />
        </Button>
        <h3
          {...gridItem}
          onKeyDown={onHeadingKeyDown}
          className={cn(
            "min-w-0 flex-1 truncate rounded-md border border-transparent font-medium outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            nested ? "text-base sm:text-xs" : "text-base sm:text-sm"
          )}
        >
          {folder.title}
        </h3>
        {isCollapsed && (
          <span className="flex-shrink-0 text-xs text-muted-foreground tabular-nums">
            {bookmarkCount}
            <span className="sr-only">
              {bookmarkCount === 1 ? " bookmark" : " bookmarks"}
            </span>
          </span>
        )}
        <FolderMenu
          folder={folder}
          childCount={children.length}
          layout={layout}
          onToggleLayout={toggleLayout}
        />
      </div>

      {/* A collapsed card is its header alone. `contents` keeps the body out
          of the layout, so the card's own gap still spaces its children. */}
      {!isCollapsed && (
        <div id={bodyId} className="contents">
          {/* Bookmarks */}
          {bookmarks.length > 0 && (
            <div
              className={cn(
                layout === "grid"
                  ? "grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1"
                  : "flex flex-col"
              )}
            >
              {bookmarks.map((bookmark, index) => (
                <BookmarkItem
                  key={bookmark.id}
                  bookmark={bookmark}
                  layout={layout}
                  sortableIndex={index}
                  folderId={folder.id}
                />
              ))}
            </div>
          )}

          {/* Nested subfolders (only in nested mode) */}
          {nestedFolders &&
            subfolders.map((subfolder) => (
              <LazyCard
                key={subfolder.id}
                folder={subfolder}
                nestedFolders
                estimatedHeight={estimateCardHeight(
                  subfolder,
                  cardLayouts,
                  collapsedFolders
                )}
              >
                <BookmarkCard folder={subfolder} nested />
              </LazyCard>
            ))}
        </div>
      )}
    </div>
  )
})
