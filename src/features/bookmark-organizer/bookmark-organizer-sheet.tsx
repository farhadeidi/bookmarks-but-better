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
import {
  BookmarkOrganizerTree,
  type BookmarkOrganizerTreeHandle,
} from "./bookmark-organizer-tree"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"

export function BookmarkOrganizerSheet() {
  const bookmarkOrganizerOpen = useUIStore((s) => s.bookmarkOrganizerOpen)
  const closeBookmarkOrganizer = useUIStore((s) => s.closeBookmarkOrganizer)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const mutationError = useBookmarkStore((s) => s.mutationError)
  const clearMutationError = useBookmarkStore((s) => s.clearMutationError)

  const creatingItem = useUIStore((s) => s.creatingItem)

  const foldersOnly = usePreferencesStore(
    (s) => s.isFoldersOnlyEnabledInTreeEditor
  )
  const setFoldersOnly = usePreferencesStore(
    (s) => s.setIsFoldersOnlyEnabledInTreeEditor
  )

  const treeRef = React.useRef<BookmarkOrganizerTreeHandle>(null)
  const lastCreatingItemRef = React.useRef<{ parentId: string } | null>(null)

  React.useEffect(() => {
    if (creatingItem) {
      lastCreatingItemRef.current = creatingItem
    } else if (lastCreatingItemRef.current) {
      treeRef.current?.invalidate(lastCreatingItemRef.current.parentId)
      lastCreatingItemRef.current = null
    }
  }, [creatingItem])

  // A drag has no dialog to report into, so a refused reorder would otherwise
  // be silent — the row would just spring back with no explanation. Clearing
  // on every open/close keeps a stale message from greeting the next visit.
  React.useEffect(() => {
    clearMutationError()
  }, [bookmarkOrganizerOpen, clearMutationError])

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
          className="data-[side=right]:w-full data-[side=right]:sm:w-[40rem] data-[side=right]:sm:max-w-none data-[side=right]:lg:w-[44rem]"
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
                <div className="flex items-center gap-2">
                  <Switch
                    id="folders-only"
                    size="sm"
                    checked={foldersOnly}
                    onCheckedChange={setFoldersOnly}
                  />
                  <Label
                    htmlFor="folders-only"
                    className="text-xs text-muted-foreground"
                  >
                    Folders Only
                  </Label>
                </div>
                <div className="ml-auto flex items-center gap-2">
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
                </div>
              </div>

              {mutationError && (
                <p
                  role="alert"
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {mutationError}
                </p>
              )}
            </div>

            <ScrollArea className="min-h-0 flex-1 px-6 py-4">
              <BookmarkOrganizerTree
                rootFolderId={rootFolderId}
                showBookmarks={!foldersOnly}
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
