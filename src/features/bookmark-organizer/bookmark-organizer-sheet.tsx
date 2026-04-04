import * as React from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RootFolderSelect } from "@/features/root-folder-select"
import { BookmarkOrganizerCreateDialog } from "./bookmark-organizer-create-dialog"
import { BookmarkOrganizerTree, type BookmarkOrganizerTreeHandle } from "./bookmark-organizer-tree"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"

export function BookmarkOrganizerSheet() {
  const bookmarkOrganizerOpen = useUIStore((s) => s.bookmarkOrganizerOpen)
  const closeBookmarkOrganizer = useUIStore((s) => s.closeBookmarkOrganizer)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)

  const creatingItem = useUIStore((s) => s.creatingItem)

  const treeRef = React.useRef<BookmarkOrganizerTreeHandle>(null)
  const [showBookmarks, setShowBookmarks] = React.useState(true)
  const lastCreatingItemRef = React.useRef<{ parentId: string } | null>(null)

  React.useEffect(() => {
    if (creatingItem) {
      lastCreatingItemRef.current = creatingItem
    } else if (lastCreatingItemRef.current) {
      treeRef.current?.invalidate(lastCreatingItemRef.current.parentId)
      lastCreatingItemRef.current = null
    }
  }, [creatingItem])

  return (
    <>
      <Sheet
        open={bookmarkOrganizerOpen}
        onOpenChange={(open) => {
          if (!open) {
            closeBookmarkOrganizer()
          }
        }}
      >
        <SheetContent
          side="right"
          className="data-[side=right]:w-full data-[side=right]:sm:w-[40rem] data-[side=right]:lg:w-[44rem] data-[side=right]:sm:max-w-none"
        >
          <div className="flex h-full min-h-0 flex-col">
            <SheetHeader className="border-b border-border/70 px-6 pb-4">
              <SheetTitle>Bookmark Organizer</SheetTitle>
              <SheetDescription>
                Reorder, rename, create, and delete items inside the selected
                root subtree.
              </SheetDescription>
            </SheetHeader>

            <div className="flex flex-col gap-4 border-b border-border/70 px-6 py-4">
              <RootFolderSelect
                label="Root folder"
                description="Changes apply to the selected root subtree."
                value={rootFolderId}
                onChange={setRootFolderId}
              />

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => treeRef.current?.expandAll()}
                >
                  Expand All
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => treeRef.current?.collapseAll()}
                >
                  Collapse All
                </Button>
                <div className="ml-auto flex items-center gap-2">
                  <Label htmlFor="show-bookmarks" className="text-xs text-muted-foreground">
                    Bookmarks
                  </Label>
                  <Switch
                    id="show-bookmarks"
                    size="sm"
                    checked={showBookmarks}
                    onCheckedChange={setShowBookmarks}
                  />
                </div>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-6 py-4">
              <BookmarkOrganizerTree
                rootFolderId={rootFolderId}
                showBookmarks={showBookmarks}
                treeRef={treeRef}
              />
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      <BookmarkOrganizerCreateDialog />
    </>
  )
}
