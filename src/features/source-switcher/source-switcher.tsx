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
import { enabledSourceDescriptors, useSourceStore } from "@/stores/source-store"

/**
 * How many tabs fit before the switcher collapses into a dropdown. A source
 * count past this is a daemon hosting many Vaults; overflow behaviour beats
 * unbounded tabs.
 */
const MAX_TABS = 6

/**
 * The tab-style source switcher above the bookmarks: exactly one source is
 * Active, profile-wide, and clicking a tab is an explicit Source Session
 * transition.
 *
 * It exists only when there is a choice to make. With a single enabled
 * source there is nothing to switch to, so nothing is drawn: a control that
 * cannot change anything is noise above every bookmark, and the source's
 * health is already reported where it matters — the recovery state when a
 * daemon is unreachable, and Settings → Sources.
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

  if (sources.length < 2) return null

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
