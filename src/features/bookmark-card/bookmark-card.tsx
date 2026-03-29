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
import { useFolderDropTarget } from "@/features/dnd"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import type { BookmarkNode } from "@/browser"

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Folder actions" />
        }
      >
        <HugeiconsIcon icon={MoreVerticalIcon} size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onToggleLayout}>
          <HugeiconsIcon
            icon={layout === "list" ? GridViewIcon : Menu02Icon}
            size={14}
          />
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
              childCount,
            })
          }
        >
          <HugeiconsIcon icon={Delete02Icon} size={14} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
})

interface BookmarkCardProps {
  folder: BookmarkNode
  nested?: boolean
  dragHandleRef?: React.RefObject<HTMLElement | null>
}

export const BookmarkCard = React.memo(function BookmarkCard({
  folder,
  nested = false,
  dragHandleRef,
}: BookmarkCardProps) {
  const layout = usePreferencesStore((s) => s.cardLayouts[folder.id] ?? "list")
  const setCardLayout = usePreferencesStore((s) => s.setCardLayout)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const adapter = useBookmarkStore((s) => s.adapter)

  const { ref: dropRef, isOver } = useFolderDropTarget({ folderId: folder.id })

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
      ref={dropRef as React.RefObject<HTMLDivElement>}
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-border transition-shadow",
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
        <h3
          className={cn(
            "min-w-0 flex-1 truncate font-medium",
            nested ? "text-xs" : "text-sm"
          )}
        >
          {folder.title}
        </h3>
        <FolderMenu
          folder={folder}
          childCount={children.length}
          layout={layout}
          onToggleLayout={toggleLayout}
        />
      </div>

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
              faviconUrl={getFaviconUrl(bookmark.url!)}
              faviconFallbackUrl={getFallbackFaviconUrl(bookmark.url!)}
              sortableIndex={index}
              folderId={folder.id}
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
})
