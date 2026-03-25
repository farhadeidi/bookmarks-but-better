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
  PencilEdit01Icon,
  Delete02Icon,
  ArrowUpRight01Icon,
} from "@hugeicons/core-free-icons"
import { BookmarkItem } from "@/features/bookmark-item"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
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
  const openEditor = useUIStore((s) => s.openEditor)
  const openDeleteConfirm = useUIStore((s) => s.openDeleteConfirm)

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
          className={cn("truncate font-medium", nested ? "text-xs" : "text-sm")}
        >
          {folder.title}
        </h3>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Folder actions"
                />
              }
            >
              <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={toggleLayout}>
                <HugeiconsIcon icon={layout === "list" ? GridViewIcon : Menu02Icon} size={14} />
                {layout === "list" ? "Grid view" : "List view"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => openEditor(folder)}>
                <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => adapter?.bookmarks.openInManager(folder.id)}
              >
                <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
                View in manager
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                onClick={() =>
                  openDeleteConfirm({
                    id: folder.id,
                    title: folder.title,
                    type: "folder",
                    childCount: children.length,
                  })
                }
              >
                <HugeiconsIcon icon={Delete02Icon} size={14} />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
