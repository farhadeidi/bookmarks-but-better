import * as React from "react"
import { Favicon } from "./favicon"
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PencilEdit01Icon,
  Copy01Icon,
  Delete02Icon,
  ArrowUpRight01Icon,
} from "@hugeicons/core-free-icons"
import type { BookmarkNode } from "@/browser"
import { useUIStore } from "@/stores/ui-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useSortableBookmark, DropIndicator } from "@/features/dnd"
// Past the grid's barrel on purpose: importing it would pull `BookmarkGrid`,
// which renders this row, back into the row's own module graph.
import { useGridItem } from "@/features/bookmark-grid/use-grid-navigation"
import { cn } from "@/lib/utils"
import { describeReadOnly } from "@/lib/bookmark-utils"

interface BookmarkItemProps {
  bookmark: BookmarkNode
  layout: "list" | "grid"
  sortableIndex: number
  folderId: string
}

export const BookmarkItem = React.memo(function BookmarkItem({
  bookmark,
  layout,
  sortableIndex,
  folderId,
}: BookmarkItemProps) {
  const adapter = useBookmarkStore((s) => s.adapter)
  const moveEnabled = adapter?.capabilities.move ?? true
  const reorderEnabled = adapter?.capabilities.reorder ?? true
  const setChildOrderEnabled = adapter?.capabilities.setChildOrder ?? false
  const isReadOnly = bookmark.readOnly ?? false

  const {
    ref: sortableRef,
    isDragging,
    closestEdge,
  } = useSortableBookmark({
    id: bookmark.id,
    index: sortableIndex,
    folderId,
    layout,
    // Draggable whenever a cross-folder move or a same-folder reorder is
    // possible at all — dnd-monitor decides at drop time which of the two
    // this particular drop is, and whether the adapter actually allows it.
    // A same-folder reorder can travel on either ordering capability.
    disabled:
      (!moveEnabled && !reorderEnabled && !setChildOrderEnabled) || isReadOnly,
  })

  // The row's stop in the grid's roving tab order. It rides on the anchor the
  // hover card already renders, so `Enter` stays the browser's own "follow
  // this link" rather than something re-implemented here.
  const gridItem = useGridItem(bookmark.id)

  const openEditor = useUIStore((s) => s.openEditor)
  const openDeleteConfirm = useUIStore((s) => s.openDeleteConfirm)

  const handleCopyUrl = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (bookmark.url) {
        navigator.clipboard.writeText(bookmark.url)
      }
    },
    [bookmark.url]
  )

  const handleEdit = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      openEditor(bookmark)
    },
    [bookmark, openEditor]
  )

  const handleDelete = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      openDeleteConfirm({
        id: bookmark.id,
        title: bookmark.title,
        type: "bookmark",
      })
    },
    [bookmark, openDeleteConfirm]
  )

  const canOpenInManager = adapter?.capabilities.openInManager ?? false

  const handleOpenInManager = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      adapter?.bookmarks.openInManager(bookmark.id)
    },
    [bookmark.id, adapter]
  )

  if (layout === "grid") {
    return (
      <div
        ref={sortableRef as React.RefObject<HTMLDivElement>}
        className={cn("relative", isDragging && "opacity-40")}
      >
        <HoverCard>
          <HoverCardTrigger
            render={
              <a
                href={bookmark.url}
                draggable="false"
                {...gridItem}
                className="flex items-center justify-center rounded-lg border border-transparent p-2 transition-colors outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              />
            }
          >
            <Favicon
              url={bookmark.url ?? ""}
              title={bookmark.title}
              size={40}
            />
          </HoverCardTrigger>
          <HoverCardContent side="bottom" className="w-64">
            <HoverCardBody
              bookmark={bookmark}
              onEdit={handleEdit}
              onCopyUrl={handleCopyUrl}
              onDelete={handleDelete}
              onOpenInManager={
                canOpenInManager ? handleOpenInManager : undefined
              }
            />
          </HoverCardContent>
        </HoverCard>
        <DropIndicator edge={closestEdge} />
      </div>
    )
  }

  return (
    <div
      ref={sortableRef as React.RefObject<HTMLDivElement>}
      className={cn("relative", isDragging && "opacity-40")}
    >
      <HoverCard>
        <HoverCardTrigger
          render={
            <a
              href={bookmark.url}
              draggable="false"
              {...gridItem}
              className="flex min-w-0 items-center gap-2.5 rounded-lg border border-transparent px-2 py-2.5 transition-colors outline-none hover:bg-accent focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:py-1.5"
            />
          }
        >
          <Favicon url={bookmark.url ?? ""} title={bookmark.title} size={16} />
          <span className="min-w-0 truncate text-base sm:text-sm">
            {bookmark.title}
          </span>
        </HoverCardTrigger>
        <HoverCardContent side="right" className="w-72">
          <HoverCardBody
            bookmark={bookmark}
            onEdit={handleEdit}
            onCopyUrl={handleCopyUrl}
            onDelete={handleDelete}
            onOpenInManager={canOpenInManager ? handleOpenInManager : undefined}
          />
        </HoverCardContent>
      </HoverCard>
      <DropIndicator edge={closestEdge} />
    </div>
  )
})

const HoverCardBody = React.memo(function HoverCardBody({
  bookmark,
  onEdit,
  onCopyUrl,
  onDelete,
  onOpenInManager,
}: {
  bookmark: BookmarkNode
  onEdit: (e: React.MouseEvent) => void
  onCopyUrl: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  onOpenInManager?: (e: React.MouseEvent) => void
}) {
  const isReadOnly = bookmark.readOnly ?? false
  const readOnlyReason = isReadOnly ? describeReadOnly(bookmark) : undefined

  return (
    <div className="flex flex-col gap-2">
      <div className="text-sm font-medium">{bookmark.title}</div>
      {bookmark.url && (
        <div className="truncate text-xs text-muted-foreground">
          {bookmark.url}
        </div>
      )}
      <div className="flex items-center gap-1 pt-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-disabled={isReadOnly || undefined}
                onClick={isReadOnly ? (e) => e.preventDefault() : onEdit}
              />
            }
          >
            <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
          </TooltipTrigger>
          <TooltipContent>{readOnlyReason ?? "Edit"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-sm" onClick={onCopyUrl} />
            }
          >
            <HugeiconsIcon icon={Copy01Icon} size={14} />
          </TooltipTrigger>
          <TooltipContent>Copy URL</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-disabled={isReadOnly || undefined}
                onClick={isReadOnly ? (e) => e.preventDefault() : onDelete}
              />
            }
          >
            <HugeiconsIcon icon={Delete02Icon} size={14} />
          </TooltipTrigger>
          <TooltipContent>{readOnlyReason ?? "Delete"}</TooltipContent>
        </Tooltip>
        {onOpenInManager && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={onOpenInManager}
                />
              }
            >
              <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
            </TooltipTrigger>
            <TooltipContent>Show in bookmark manager</TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  )
})
