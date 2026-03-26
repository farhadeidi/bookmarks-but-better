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
import { cn } from "@/lib/utils"

interface BookmarkItemProps {
  bookmark: BookmarkNode
  layout: "list" | "grid"
  faviconUrl: string
  faviconFallbackUrl?: string
  sortableIndex: number
  folderId: string
}

export function BookmarkItem({
  bookmark,
  layout,
  faviconUrl,
  faviconFallbackUrl,
  sortableIndex,
  folderId,
}: BookmarkItemProps) {
  const { ref: sortableRef, isDragging, closestEdge } = useSortableBookmark({
    id: bookmark.id,
    index: sortableIndex,
    folderId,
    layout,
  })

  const openEditor = useUIStore((s) => s.openEditor)
  const openDeleteConfirm = useUIStore((s) => s.openDeleteConfirm)
  const adapter = useBookmarkStore((s) => s.adapter)

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
                className="flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-accent"
              />
            }
          >
            <Favicon
              url={bookmark.url ?? ""}
              primarySrc={faviconUrl}
              fallbackSrc={faviconFallbackUrl}
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
              onOpenInManager={handleOpenInManager}
            />
          </HoverCardContent>
        </HoverCard>
        <DropIndicator edge={closestEdge} />
      </div>
    )
  }

  // List layout
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
              target="_blank"
              rel="noopener noreferrer"
              draggable="false"
              className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
            />
          }
        >
          <Favicon
            url={bookmark.url ?? ""}
            primarySrc={faviconUrl}
            fallbackSrc={faviconFallbackUrl}
            title={bookmark.title}
            size={16}
          />
          <span className="truncate text-sm">{bookmark.title}</span>
        </HoverCardTrigger>
        <HoverCardContent side="right" className="w-72">
          <HoverCardBody
            bookmark={bookmark}
            onEdit={handleEdit}
            onCopyUrl={handleCopyUrl}
            onDelete={handleDelete}
            onOpenInManager={handleOpenInManager}
          />
        </HoverCardContent>
      </HoverCard>
      <DropIndicator edge={closestEdge} />
    </div>
  )
}

function HoverCardBody({
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
  onOpenInManager: (e: React.MouseEvent) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-medium text-sm">{bookmark.title}</div>
      {bookmark.url && (
        <div className="truncate text-xs text-muted-foreground">
          {bookmark.url}
        </div>
      )}
      <div className="flex items-center gap-1 pt-1">
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onEdit} />}>
            <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
          </TooltipTrigger>
          <TooltipContent>Edit</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onCopyUrl} />}>
            <HugeiconsIcon icon={Copy01Icon} size={14} />
          </TooltipTrigger>
          <TooltipContent>Copy URL</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onDelete} />}>
            <HugeiconsIcon icon={Delete02Icon} size={14} />
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={onOpenInManager} />}>
            <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
          </TooltipTrigger>
          <TooltipContent>Show in bookmark manager</TooltipContent>
        </Tooltip>
      </div>
    </div>
  )
}
