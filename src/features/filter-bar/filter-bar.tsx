import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { enabledSourceDescriptors, useSourceStore } from "@/stores/source-store"
import { SourceSwitcher } from "@/features/source-switcher"
import { RootFolderControl } from "@/features/root-folder-control"
import { hasRootFolderChoice } from "@/features/root-folder-select"

/**
 * The storefront-style filter bar above the grid (#95): "what am I looking
 * at" — which source, and which folder within it — answered in one row.
 *
 * Two quiet text dropdowns read like a breadcrumb path: `Browser bookmarks /
 * All bookmarks`. Each control hides itself when it has nothing to offer
 * (see `SourceSwitcher` and `RootFolderControl`); the `/` separator is drawn
 * here, reading the same two conditions, only when both are visible.
 *
 * The app header places it and matches the grid's width, so the row lines up
 * with the left edge of the first card column.
 */
export function FilterBar() {
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
    <div className="flex min-h-8 min-w-0 flex-wrap items-center gap-0.5 text-sm">
      <SourceSwitcher />
      {showSources && showFolders && (
        <span aria-hidden className="text-muted-foreground/40">
          /
        </span>
      )}
      <RootFolderControl />
    </div>
  )
}
