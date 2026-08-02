import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { Bookmark02Icon, Folder01Icon } from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { resolveCreateParentId } from "@/features/root-folder-select"

export function BookmarkGridEmpty() {
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const tree = useBookmarkStore((s) => s.tree)
  const adapter = useBookmarkStore((s) => s.adapter)
  const openCreateItem = useUIStore((s) => s.openCreateItem)
  const openBookmarkOrganizer = useUIStore((s) => s.openBookmarkOrganizer)
  const openSettings = useUIStore((s) => s.openSettings)

  const createParentId = React.useMemo(
    () =>
      resolveCreateParentId(
        tree,
        rootFolderId,
        adapter?.capabilities.rootIsCreatable ?? false
      ),
    [rootFolderId, tree, adapter]
  )

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-dashed border-border/70 p-12 text-center">
      <h2 className="font-medium text-foreground">No bookmarks yet</h2>

      {createParentId ? (
        <>
          <p className="text-sm text-muted-foreground">
            Create a folder or bookmark to get started.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openCreateItem({ type: "folder", parentId: createParentId })
              }
            >
              <HugeiconsIcon icon={Folder01Icon} size={14} />
              New Folder
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openCreateItem({ type: "bookmark", parentId: createParentId })
              }
            >
              <HugeiconsIcon icon={Bookmark02Icon} size={14} />
              New Bookmark
            </Button>
            <Button variant="ghost" size="sm" onClick={openBookmarkOrganizer}>
              Open Bookmark Organizer
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            No folder is selected as the dashboard's root yet. Choose a root
            folder in Settings to see it here.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={openSettings}
          >
            Open Settings
          </Button>
        </>
      )}
    </div>
  )
}
