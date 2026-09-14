import * as React from "react"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { enabledSourceDescriptors, useSourceStore } from "@/stores/source-store"
import { SourceSwitcher } from "@/features/source-switcher"
import { RootFolderControl } from "@/features/root-folder-control"
import { hasRootFolderChoice } from "@/features/root-folder-select"
import { cn } from "@/lib/utils"

/**
 * The storefront-style filter bar above the grid (#95): "what am I looking
 * at" — which source, and which folder within it — answered in one row.
 *
 * Two quiet text dropdowns read like a breadcrumb path: `Browser bookmarks /
 * All bookmarks`. Each control hides itself when it has nothing to offer
 * (see `SourceSwitcher` and `RootFolderControl`); the `/` separator is drawn
 * here, reading the same two conditions, only when both are visible.
 *
 * Mirrors the grid's own width/centering so the row lines up with the left
 * edge of the first card column.
 */
export function FilterBar() {
  const containerMode = usePreferencesStore((s) => s.containerMode)

  const config = useSourceStore((s) => s.config)
  const sources = React.useMemo(
    () => enabledSourceDescriptors({ config }),
    [config]
  )
  const showSources = sources.length >= 2

  const tree = useBookmarkStore((s) => s.tree)
  const rootIsCreatable = useBookmarkStore(
    (s) => s.adapter?.capabilities.rootIsCreatable ?? false
  )
  const showFolders = hasRootFolderChoice(tree, rootIsCreatable)

  if (!showSources && !showFolders) return null

  return (
    <div
      className={cn(
        "w-full min-w-0",
        containerMode === "contained" && "mx-auto max-w-[1440px]"
      )}
    >
      <div className="flex min-h-7 min-w-0 flex-wrap items-center gap-1.5 px-1 text-sm">
        <SourceSwitcher />
        {showSources && showFolders && (
          <span aria-hidden className="text-muted-foreground/40">
            /
          </span>
        )}
        <RootFolderControl />
      </div>
    </div>
  )
}
