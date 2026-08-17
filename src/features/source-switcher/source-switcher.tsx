import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { enabledSourceDescriptors, useSourceStore } from "@/stores/source-store"
import { useUIStore } from "@/stores/ui-store"

/**
 * How many tabs fit before the switcher collapses into a dropdown. A source
 * count past this is a daemon hosting many Vaults; overflow behaviour beats
 * unbounded tabs.
 */
const MAX_TABS = 6

/**
 * The compact source control above the bookmarks.
 *
 * With more than one enabled source it is the tab-style switcher: exactly one
 * source is Active, profile-wide, and clicking a tab is an explicit Source
 * Session transition. With a single enabled source a selector would be
 * meaningless, so it becomes a name-and-health badge that links to the
 * Sources settings instead.
 */
export function SourceSwitcher() {
  // Derived from the config reference (which changes only when the config
  // does) rather than a selector returning a fresh array per notification —
  // that would re-render forever under zustand's identity comparison.
  const config = useSourceStore((s) => s.config)
  const sources = React.useMemo(
    () => enabledSourceDescriptors({ config }),
    [config]
  )
  const activeSourceId = useSourceStore((s) => s.activeSourceId)
  const switching = useSourceStore((s) => s.switching)
  const switchSource = useSourceStore((s) => s.switchSource)
  const status = useBookmarkStore((s) => s.status)
  const openSettings = useUIStore((s) => s.openSettings)

  if (sources.length === 0) return null

  if (sources.length === 1) {
    const only = sources[0]
    const healthy = status === "ready"
    return (
      <div className="flex min-w-0 justify-center">
        <button
          type="button"
          onClick={openSettings}
          className="inline-flex max-w-full items-center gap-2 rounded-full bg-muted/60 px-3 py-2.5 text-base text-muted-foreground ring-1 ring-border/60 hover:bg-muted hover:text-foreground sm:py-1.5 sm:text-sm"
          title="Manage sources in Settings → Sources"
        >
          <span
            role="img"
            aria-label={healthy ? "Source is healthy" : "Source is unavailable"}
            className={cn(
              "size-1.5 rounded-full",
              healthy ? "bg-green-500" : "bg-red-500"
            )}
          />
          <span className="max-w-60 truncate font-medium text-foreground">
            {only.label}
          </span>
        </button>
      </div>
    )
  }

  const visible = sources.slice(0, MAX_TABS)
  const overflow = sources.slice(MAX_TABS)

  return (
    <div className="flex min-w-0 justify-center">
      <div
        role="tablist"
        aria-label="Bookmark source"
        className="no-scrollbar flex w-max max-w-full flex-nowrap items-center justify-start gap-1 overflow-x-auto rounded-full bg-muted/60 p-1 ring-1 ring-border/60"
      >
        {visible.map((source) => (
          <button
            key={source.id}
            role="tab"
            type="button"
            aria-selected={source.id === activeSourceId}
            disabled={switching || source.id === activeSourceId}
            onClick={() => void switchSource(source.id)}
            title={
              source.id === activeSourceId
                ? "This is the active source"
                : `Switch to ${source.label}`
            }
            className={cn(
              "inline-flex max-w-56 shrink-0 items-center gap-1.5 rounded-full px-3 py-2.5 text-base font-medium sm:py-1.5 sm:text-sm",
              source.id === activeSourceId
                ? "bg-background text-foreground shadow-xs ring-1 ring-border dark:shadow-none"
                : "text-muted-foreground hover:bg-background/50 hover:text-foreground"
            )}
          >
            {source.kind === "standalone" && (
              <span className="text-amber-600 dark:text-amber-400">Legacy</span>
            )}
            <span className="truncate">{source.label}</span>
          </button>
        ))}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" className="h-7 px-2 text-sm">
                  +{overflow.length} more
                </Button>
              }
            />
            <DropdownMenuContent align="center">
              <DropdownMenuLabel>Other sources</DropdownMenuLabel>
              {overflow.map((source) => (
                <DropdownMenuItem
                  key={source.id}
                  disabled={source.id === activeSourceId}
                  onClick={() => void switchSource(source.id)}
                >
                  {source.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}
