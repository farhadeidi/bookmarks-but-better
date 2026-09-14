import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
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

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className={cn(
                "inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-muted/60 hover:text-foreground",
                rootFolderId ? "text-foreground" : "text-muted-foreground"
              )}
            />
          }
        >
          <span className="truncate">{displayLabel}</span>
          {chevron}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-auto min-w-56">
          <DropdownMenuItem onClick={() => setRootFolderId(null)}>
            {ALL_BOOKMARKS_LABEL}
          </DropdownMenuItem>
          {folders.map((folder) => (
            <DropdownMenuItem
              key={folder.id}
              onClick={() => setRootFolderId(folder.id)}
            >
              {folder.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* The narrowed-root cue: only worth a click when the root isn't
          already "all bookmarks". */}
      {rootFolderId && (
        <button
          type="button"
          aria-label="Show all bookmarks"
          title="All bookmarks"
          onClick={() => setRootFolderId(null)}
          className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
        >
          <HugeiconsIcon
            icon={Cancel01Icon}
            strokeWidth={2}
            className="size-3"
          />
        </button>
      )}
    </>
  )
}
