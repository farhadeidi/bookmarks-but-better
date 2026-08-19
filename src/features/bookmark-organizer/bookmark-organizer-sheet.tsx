import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  Bookmark02Icon,
  Folder01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  RootFolderSelect,
  resolveCreateParentId,
} from "@/features/root-folder-select"
import { BookmarkOrganizerCreateDialog } from "./bookmark-organizer-create-dialog"
import {
  BookmarkOrganizerTree,
  type BookmarkOrganizerTreeHandle,
} from "./bookmark-organizer-tree"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { findNodePath } from "@/lib/bookmark-utils"

export function BookmarkOrganizerSheet() {
  const bookmarkOrganizerOpen = useUIStore((s) => s.bookmarkOrganizerOpen)
  const closeBookmarkOrganizer = useUIStore((s) => s.closeBookmarkOrganizer)
  const organizerRevealId = useUIStore((s) => s.organizerRevealId)
  const clearOrganizerReveal = useUIStore((s) => s.clearOrganizerReveal)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)
  const adapter = useBookmarkStore((s) => s.adapter)
  const mutationError = useBookmarkStore((s) => s.mutationError)
  const clearMutationError = useBookmarkStore((s) => s.clearMutationError)

  const creatingItem = useUIStore((s) => s.creatingItem)
  const openCreateItem = useUIStore((s) => s.openCreateItem)

  const foldersOnly = usePreferencesStore(
    (s) => s.isFoldersOnlyEnabledInTreeEditor
  )
  const setFoldersOnly = usePreferencesStore(
    (s) => s.setIsFoldersOnlyEnabledInTreeEditor
  )

  // Search covers the whole Active Source, so a revealed item can sit outside
  // the pinned root, or be a bookmark while "Folders Only" is on. Both are
  // relaxed for the visit rather than written back: the root folder is a
  // saved preference that also drives the dashboard, and a reveal is not the
  // user asking to change it.
  const revealPath = organizerRevealId
    ? findNodePath(tree, organizerRevealId)
    : null
  const revealTarget = revealPath?.[revealPath.length - 1] ?? null
  const revealNeedsWholeSource =
    revealPath !== null &&
    rootFolder !== null &&
    !revealPath.some((node) => node.id === rootFolder.id)
  const showBookmarks = !foldersOnly || revealTarget?.url != null
  // Every header control describes the tree actually on screen, so a widened
  // visit creates where it is showing rather than where the saved root points.
  const shownRootFolderId = revealNeedsWholeSource ? null : rootFolderId
  const createParentId = resolveCreateParentId(
    tree,
    shownRootFolderId,
    adapter?.capabilities.rootIsCreatable ?? false
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
                description={
                  revealNeedsWholeSource
                    ? "Widened to the whole source to show a search result. Your saved root folder is unchanged."
                    : "Changes apply to the selected root subtree."
                }
                value={shownRootFolderId}
                onChange={(id) => {
                  clearOrganizerReveal()
                  setRootFolderId(id)
                }}
              />

              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2">
                  <Switch
                    id="folders-only"
                    size="sm"
                    checked={foldersOnly}
                    onCheckedChange={(checked) => {
                      clearOrganizerReveal()
                      setFoldersOnly(checked)
                    }}
                  />
                  <Label
                    htmlFor="folders-only"
                    className="text-xs text-muted-foreground"
                  >
                    Folders Only
                  </Label>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {createParentId ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button type="button" variant="outline" size="xs">
                            <HugeiconsIcon icon={Add01Icon} size={14} />
                            New
                          </Button>
                        }
                      />
                      <DropdownMenuContent side="bottom" align="end">
                        <DropdownMenuItem
                          onClick={() =>
                            openCreateItem({
                              type: "folder",
                              parentId: createParentId,
                            })
                          }
                        >
                          <HugeiconsIcon
                            icon={Folder01Icon}
                            size={14}
                            className="text-primary"
                          />
                          New Folder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() =>
                            openCreateItem({
                              type: "bookmark",
                              parentId: createParentId,
                            })
                          }
                        >
                          <HugeiconsIcon
                            icon={Bookmark02Icon}
                            size={14}
                            className="text-muted-foreground"
                          />
                          New Bookmark
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="outline"
                            size="xs"
                            disabled
                            aria-disabled="true"
                          >
                            <HugeiconsIcon icon={Add01Icon} size={14} />
                            New
                          </Button>
                        }
                      />
                      <TooltipContent side="bottom">
                        Choose a root folder above before creating items here.
                      </TooltipContent>
                    </Tooltip>
                  )}
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
                rootFolderId={shownRootFolderId}
                showBookmarks={showBookmarks}
                revealId={organizerRevealId}
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
