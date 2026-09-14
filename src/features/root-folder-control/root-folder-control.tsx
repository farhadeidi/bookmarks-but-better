import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
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
import { cn } from "@/lib/utils"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon, Cancel01Icon } from "@hugeicons/core-free-icons"
import {
  buildRootFolderOptions,
  hasRootFolderChoice,
} from "@/features/root-folder-select"

const ALL_BOOKMARKS_LABEL = "All bookmarks"

/**
 * The new tab's reachable form of the Root folder setting: a quiet label
 * above the grid (#93) rather than the wide centered `Select` it replaced
 * (#88 / PR #91), which read as a second primary control next to the source
 * switcher. It is built on the same folder-path options `RootFolderSelect`
 * shows in Settings and onboarding — there is no second copy of the choice
 * or its labelling, just a lighter-weight trigger for it.
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
  // Mirrors the grid's own width/centering so the label lines up with the
  // left edge of the first column instead of drifting from it.
  const containerMode = usePreferencesStore((s) => s.containerMode)

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
    <div
      className={cn(
        "w-full min-w-0",
        containerMode === "contained" && "mx-auto max-w-[1440px]"
      )}
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="flex h-7 min-w-0 items-center gap-1 rounded-lg px-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
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
                  className="text-muted-foreground"
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
    </div>
  )
}
