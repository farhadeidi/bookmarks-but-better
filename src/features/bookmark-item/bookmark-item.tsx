import * as React from "react"
import { Favicon } from "./favicon"
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PencilEdit01Icon,
  Copy01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons"
import type { BookmarkNode } from "@/browser"
import { useUIStore } from "@/stores/ui-store"

interface BookmarkItemProps {
  bookmark: BookmarkNode
  layout: "list" | "grid"
  faviconUrl: string
  faviconFallbackUrl?: string
}

export function BookmarkItem({
  bookmark,
  layout,
  faviconUrl,
  faviconFallbackUrl,
}: BookmarkItemProps) {
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

  if (layout === "grid") {
    return (
      <HoverCard>
        <HoverCardTrigger
          render={
            <a
              href={bookmark.url}
              className="flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-accent"
            />
          }
        >
          <Favicon
            url={bookmark.url ?? ""}
            primarySrc={faviconUrl}
            fallbackSrc={faviconFallbackUrl}
            title={bookmark.title}
            size={32}
          />
        </HoverCardTrigger>
        <HoverCardContent className="w-64">
          <HoverCardBody
            bookmark={bookmark}
            onEdit={handleEdit}
            onCopyUrl={handleCopyUrl}
            onDelete={handleDelete}
          />
        </HoverCardContent>
      </HoverCard>
    )
  }

  // List layout
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <a
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
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
      <HoverCardContent className="w-72">
        <HoverCardBody
          bookmark={bookmark}
          onEdit={handleEdit}
          onCopyUrl={handleCopyUrl}
          onDelete={handleDelete}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

function HoverCardBody({
  bookmark,
  onEdit,
  onCopyUrl,
  onDelete,
}: {
  bookmark: BookmarkNode
  onEdit: (e: React.MouseEvent) => void
  onCopyUrl: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
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
        <Button variant="ghost" size="icon-sm" onClick={onEdit}>
          <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onCopyUrl}>
          <HugeiconsIcon icon={Copy01Icon} size={14} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete}>
          <HugeiconsIcon icon={Delete02Icon} size={14} />
        </Button>
      </div>
    </div>
  )
}
