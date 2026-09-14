import { usePreferencesStore } from "@/stores/preferences-store"
import { SourceSwitcher } from "@/features/source-switcher"
import { RootFolderControl } from "@/features/root-folder-control"
import { cn } from "@/lib/utils"

/**
 * The storefront-style filter bar above the grid (#95): "what am I looking
 * at" — which source, and which folder within it — answered in one row
 * instead of the two stacked, differently-aligned rows #93 left behind.
 * Both questions share the same rounded-full muted surface, so the row reads
 * as one control family rather than two unrelated ones.
 *
 * Mirrors the grid's own width/centering so the row lines up with the left
 * edge of the first card column. Each child hides itself independently
 * (`SourceSwitcher` with fewer than two sources, `RootFolderControl` with no
 * folder choice), so this composes them without forking either's condition;
 * with only one of the two visible, the row still starts at the left edge.
 */
export function FilterBar() {
  const containerMode = usePreferencesStore((s) => s.containerMode)

  return (
    <div
      className={cn(
        "w-full min-w-0",
        containerMode === "contained" && "mx-auto max-w-[1440px]"
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <SourceSwitcher />
        <RootFolderControl />
      </div>
    </div>
  )
}
