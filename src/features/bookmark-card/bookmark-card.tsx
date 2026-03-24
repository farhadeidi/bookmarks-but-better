import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  GridViewIcon,
  Menu02Icon,
} from "@hugeicons/core-free-icons"
import { BookmarkItem } from "@/features/bookmark-item"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BookmarkNode } from "@/browser"

interface BookmarkCardProps {
  folder: BookmarkNode
  nested?: boolean
}

export function BookmarkCard({ folder, nested = false }: BookmarkCardProps) {
  const cardLayouts = usePreferencesStore((s) => s.cardLayouts)
  const setCardLayout = usePreferencesStore((s) => s.setCardLayout)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const adapter = useBookmarkStore((s) => s.adapter)

  const layout = cardLayouts[folder.id] ?? "list"
  const children = folder.children ?? []

  // Separate direct bookmarks from subfolders
  const bookmarks = children.filter((c) => c.url !== undefined)
  const subfolders = children.filter(
    (c) => c.url === undefined && c.children !== undefined
  )

  const toggleLayout = React.useCallback(() => {
    setCardLayout(folder.id, layout === "list" ? "grid" : "list")
  }, [folder.id, layout, setCardLayout])

  const getFaviconUrl = React.useCallback(
    (pageUrl: string) => {
      return adapter?.favicon.getUrl(pageUrl) ?? ""
    },
    [adapter]
  )

  const getFallbackFaviconUrl = React.useCallback(
    (pageUrl: string) => {
      return adapter?.favicon.getFallbackUrl?.(pageUrl)
    },
    [adapter]
  )

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-border",
        nested && "ring-border/50"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3
          className={cn(
            "font-medium truncate",
            nested ? "text-xs" : "text-sm"
          )}
        >
          {folder.title}
        </h3>
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" onClick={toggleLayout} aria-label={`Switch to ${layout === "list" ? "grid" : "list"} view`} />}>
            <HugeiconsIcon
              icon={layout === "list" ? GridViewIcon : Menu02Icon}
              size={14}
            />
          </TooltipTrigger>
          <TooltipContent>{layout === "list" ? "Grid view" : "List view"}</TooltipContent>
        </Tooltip>
      </div>

      {/* Bookmarks */}
      {bookmarks.length > 0 && (
        <div
          className={cn(
            layout === "grid"
              ? "grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1"
              : "flex flex-col"
          )}
        >
          {bookmarks.map((bookmark) => (
            <BookmarkItem
              key={bookmark.id}
              bookmark={bookmark}
              layout={layout}
              faviconUrl={getFaviconUrl(bookmark.url!)}
              faviconFallbackUrl={getFallbackFaviconUrl(bookmark.url!)}
            />
          ))}
        </div>
      )}

      {/* Nested subfolders (only in nested mode) */}
      {nestedFolders &&
        subfolders.map((subfolder) => (
          <BookmarkCard key={subfolder.id} folder={subfolder} nested />
        ))}
    </div>
  )
}
