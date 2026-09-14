import { useBookmarkStore } from "@/stores/bookmark-store"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import { Cancel01Icon } from "@hugeicons/core-free-icons"
import {
  RootFolderSelect,
  hasRootFolderChoice,
} from "@/features/root-folder-select"

/**
 * The new tab's reachable form of the Root folder setting: the same picker
 * Settings and the setup wizard use, shown where people already are instead
 * of two clicks into Settings. Changing it applies immediately to the Active
 * Source, exactly like the Settings control it wraps — there is no second
 * copy of the choice.
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

  if (!hasRootFolderChoice(tree, rootIsCreatable)) return null

  return (
    <div className="flex min-w-0 items-center justify-center gap-1.5">
      <div className="w-44 min-w-0 sm:w-64">
        <RootFolderSelect value={rootFolderId} onChange={setRootFolderId} />
      </div>

      {/* The narrowed-root cue: only worth a click when the root isn't
          already "all bookmarks". */}
      {rootFolderId && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                aria-label="Show all bookmarks"
                onClick={() => setRootFolderId(null)}
              />
            }
          >
            <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
          </TooltipTrigger>
          <TooltipContent side="top">All bookmarks</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
