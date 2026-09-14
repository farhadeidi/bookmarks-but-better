import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  ArrowDown01Icon,
  FolderTreeIcon,
  Tick02Icon,
} from "@hugeicons/core-free-icons"
import {
  buildRootFolderOptions,
  hasRootFolderChoice,
} from "@/features/root-folder-select"
import { cn } from "@/lib/utils"

const ALL_BOOKMARKS_LABEL = "All bookmarks"

const chevron = (
  <HugeiconsIcon
    icon={ArrowDown01Icon}
    strokeWidth={2}
    className="size-3.5 shrink-0 opacity-70"
  />
)

const tick = (
  <HugeiconsIcon icon={Tick02Icon} strokeWidth={2} className="ml-auto" />
)

/**
 * The new tab's reachable form of the Root folder setting: a quiet text
 * dropdown in the filter bar (#95), in the same visual family as the
 * source switcher next to it — rather than the wide centered `Select` it
 * originally replaced (#88 / PR #91). It is built on the same folder-path
 * options `RootFolderSelect` shows in Settings and onboarding — there is no
 * second copy of the choice or its labelling, just a lighter-weight
 * trigger for it.
 *
 * Hidden under the same condition the wizard uses to skip its own Root
 * folder step: an empty tree, or a source with nowhere to point, has nothing
 * to offer past "all bookmarks", which is already what showing nothing here
 * means.
 */
export function RootFolderControl() {
  const tree = useBookmarkStore((s) => s.tree)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const openBookmarkOrganizer = useUIStore((s) => s.openBookmarkOrganizer)
  const rootIsCreatable = useBookmarkStore(
    (s) => s.adapter?.capabilities.rootIsCreatable ?? false
  )

  const folders = React.useMemo(() => buildRootFolderOptions(tree), [tree])
  const selected = folders.find((folder) => folder.id === rootFolderId)
  // The label is the folder itself, not the breadcrumb the menu shows: the
  // path only earns its keep when there are several similarly-named folders
  // to tell apart in the list, not in a label read at a glance.
  const displayLabel = selected
    ? (selected.label.split(" > ").pop() ?? selected.label)
    : ALL_BOOKMARKS_LABEL

  if (!hasRootFolderChoice(tree, rootIsCreatable)) return null

  // "All bookmarks" is the picker's first item, so narrowing back needs no
  // separate reset control beside the trigger.
  return (
    <DropdownMenu>
      {/* A minimum width keeps the caret clear of short folder names. */}
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex min-w-32 items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 transition-colors hover:bg-muted/60 hover:text-foreground",
              rootFolderId ? "text-foreground" : "text-muted-foreground"
            )}
          />
        }
      >
        <span className="truncate">{displayLabel}</span>
        {chevron}
      </DropdownMenuTrigger>
      {/* The folder list scrolls on its own inside a popup capped by the
          space below the trigger, so the footer action stays in view on a
          short window. Nested flex columns let the scroll viewport shrink
          to that cap. */}
      <DropdownMenuContent
        align="start"
        className="flex max-h-[min(28rem,var(--available-height))] w-auto max-w-[min(24rem,calc(100vw-2rem))] min-w-56 flex-col overflow-hidden p-0"
      >
        <ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:min-h-0 *:data-[slot=scroll-area-viewport]:flex-1">
          <div className="p-1">
            <DropdownMenuItem onClick={() => setRootFolderId(null)}>
              {ALL_BOOKMARKS_LABEL}
              {!selected && tick}
            </DropdownMenuItem>
            {folders.map((folder) => (
              <DropdownMenuItem
                key={folder.id}
                onClick={() => setRootFolderId(folder.id)}
              >
                <span className="truncate">{folder.label}</span>
                {folder.id === selected?.id && tick}
              </DropdownMenuItem>
            ))}
          </div>
        </ScrollArea>
        <DropdownMenuSeparator className="mx-0 my-0" />
        <div className="p-1">
          <DropdownMenuItem onClick={openBookmarkOrganizer}>
            <HugeiconsIcon icon={FolderTreeIcon} strokeWidth={2} />
            Edit bookmark tree
          </DropdownMenuItem>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
