import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
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

const ALL_BOOKMARKS_LABEL = "All bookmarks"

/**
 * The new tab's reachable form of the Root folder setting: a chip in the
 * filter bar (#95) — in the same visual family as the source switcher next
 * to it — rather than the wide centered `Select` it originally replaced
 * (#88 / PR #91). It is built on the same folder-path options
 * `RootFolderSelect` shows in Settings and onboarding — there is no second
 * copy of the choice or its labelling, just a lighter-weight trigger for it.
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
    <div className="flex h-8 min-w-0 shrink-0 items-center gap-0.5 rounded-full bg-muted/60 py-1 pr-1 pl-3 text-sm ring-1 ring-border/60">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 rounded-full text-foreground transition-colors hover:text-muted-foreground"
            />
          }
        >
          <span className="truncate">{displayLabel}</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            strokeWidth={2}
            className="size-3.5 shrink-0"
          />
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
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:bg-background/70"
                aria-label="Show all bookmarks"
                onClick={() => setRootFolderId(null)}
              />
            }
          >
            <HugeiconsIcon
              icon={Cancel01Icon}
              strokeWidth={2}
              className="size-3.5"
            />
          </TooltipTrigger>
          <TooltipContent side="top">All bookmarks</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
