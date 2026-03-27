import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import {
  useSortableListItem,
  useListDropMonitor,
  DropIndicator,
  sortFoldersByOrder,
} from "@/features/dnd"
import type { BookmarkNode } from "@/browser"
import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { Drag04Icon, Folder01Icon } from "@hugeicons/core-free-icons"
import { collectAllFolders, getDisplayRoot } from "@/lib/bookmark-utils"

// --- Internal sortable row ---

interface FolderRowProps {
  folder: BookmarkNode
  index: number
}

function FolderRow({ folder, index }: FolderRowProps) {
  const { ref, handleRef, isDragging, closestEdge } = useSortableListItem({
    id: folder.id,
    index,
  })

  const bookmarkCount = (folder.children ?? []).filter(
    (c) => c.url !== undefined
  ).length

  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={cn(
        "relative flex items-center gap-3 rounded-xl border border-transparent bg-muted/40 px-3 py-2 transition-opacity",
        isDragging && "opacity-40"
      )}
    >
      {/* Grip handle */}
      <button
        ref={handleRef as React.RefObject<HTMLButtonElement>}
        type="button"
        aria-label="Drag to reorder"
        className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
      >
        <HugeiconsIcon icon={Drag04Icon} size={16} strokeWidth={2} />
      </button>

      {/* Folder icon + name */}
      <HugeiconsIcon
        icon={Folder01Icon}
        size={14}
        strokeWidth={2}
        className="shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {folder.title}
      </span>

      {/* Bookmark count badge */}
      {bookmarkCount > 0 && (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          {bookmarkCount}
        </span>
      )}

      <DropIndicator edge={closestEdge} />
    </div>
  )
}

// --- Main dialog ---

export function FolderOrderDialog() {
  const open = useUIStore((s) => s.folderOrderOpen)
  const closeFolderOrder = useUIStore((s) => s.closeFolderOrder)

  const folderOrder = usePreferencesStore((s) => s.folderOrder)
  const setFolderOrder = usePreferencesStore((s) => s.setFolderOrder)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const experimentalCardDrag = usePreferencesStore(
    (s) => s.experimentalCardDrag
  )
  const setExperimentalCardDrag = usePreferencesStore(
    (s) => s.setExperimentalCardDrag
  )

  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)

  // Local copy of folder order — allows cancel without persisting
  const [localOrder, setLocalOrder] = React.useState<string[]>([])

  // Derive the full folder list based on nested mode
  const allFolders = React.useMemo(() => {
    const displayRoot = getDisplayRoot(rootFolder, tree)
    if (!displayRoot) return []
    if (nestedFolders) {
      return (displayRoot.children ?? []).filter(
        (c) => c.url === undefined && c.children !== undefined
      )
    }
    return collectAllFolders(displayRoot)
  }, [rootFolder, tree, nestedFolders])

  // Reset local order when dialog opens
  React.useEffect(() => {
    if (open) {
      setLocalOrder(folderOrder)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Ordered folders for display
  const sortedFolders = React.useMemo(
    () => sortFoldersByOrder(allFolders, localOrder),
    [allFolders, localOrder]
  )

  const orderedIds = React.useMemo(
    () => sortedFolders.map((f) => f.id),
    [sortedFolders]
  )

  const handleReorder = React.useCallback((newOrder: string[]) => {
    setLocalOrder(newOrder)
  }, [])

  // Monitor list-item drops (all @atlaskit usage stays in src/features/dnd/)
  useListDropMonitor({ active: open, orderedIds, onReorder: handleReorder })

  const handleSave = () => {
    setFolderOrder(localOrder)
    closeFolderOrder()
  }

  const handleCancel = () => {
    closeFolderOrder()
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) closeFolderOrder()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Folder Order</DialogTitle>
          <DialogDescription>
            Drag folders to set their display priority. Cards are distributed
            across columns automatically.
          </DialogDescription>
        </DialogHeader>

        {/* Sortable folder list */}
        <div className="-mx-4 no-scrollbar max-h-[40vh] overflow-y-auto px-4">
          <div className="flex flex-col gap-1.5">
            {sortedFolders.map((folder, index) => (
              <FolderRow key={folder.id} folder={folder} index={index} />
            ))}
            {sortedFolders.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No folders found.
              </p>
            )}
          </div>
        </div>

        {/* Experimental card drag toggle */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <Label className="text-sm font-medium">
                Experimental Card Sorting
              </Label>
              <p className="text-xs text-muted-foreground">
                Enable drag handles on folder cards for direct reordering.
              </p>
            </div>
            <Switch
              checked={experimentalCardDrag}
              onCheckedChange={(checked) => setExperimentalCardDrag(checked)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Order</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
