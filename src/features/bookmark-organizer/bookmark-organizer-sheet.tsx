import { Button } from "@/components/ui/button"
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
import { BookmarkOrganizerTree } from "./bookmark-organizer-tree"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"

export function BookmarkOrganizerSheet() {
  const bookmarkOrganizerOpen = useUIStore((s) => s.bookmarkOrganizerOpen)
  const closeBookmarkOrganizer = useUIStore((s) => s.closeBookmarkOrganizer)
  const openCreateItem = useUIStore((s) => s.openCreateItem)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)

  const activeParentId = rootFolder?.id ?? tree[0]?.id ?? null

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
        <SheetContent side="right" className="sm:max-w-2xl">
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

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!activeParentId}
                  onClick={() => {
                    if (!activeParentId) {
                      return
                    }

                    openCreateItem({
                      type: "folder",
                      parentId: activeParentId,
                    })
                  }}
                >
                  New Folder
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!activeParentId}
                  onClick={() => {
                    if (!activeParentId) {
                      return
                    }

                    openCreateItem({
                      type: "bookmark",
                      parentId: activeParentId,
                    })
                  }}
                >
                  New Bookmark
                </Button>
              </div>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-6 py-4">
              <BookmarkOrganizerTree rootFolderId={rootFolderId} />
            </ScrollArea>
          </div>
        </SheetContent>
      </Sheet>

      <BookmarkOrganizerCreateDialog />
    </>
  )
}
