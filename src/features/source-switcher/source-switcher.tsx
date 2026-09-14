import * as React from "react"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { enabledSourceDescriptors, useSourceStore } from "@/stores/source-store"
import { HugeiconsIcon } from "@hugeicons/react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"

const chevron = (
  <HugeiconsIcon
    icon={ArrowDown01Icon}
    strokeWidth={2}
    className="size-3.5 shrink-0 opacity-70"
  />
)

/**
 * The quiet text dropdown that names the active source in the filter bar
 * above the bookmarks: exactly one source is Active, profile-wide, and
 * picking another from the menu is an explicit Source Session transition.
 *
 * It exists only when there is a choice to make. With a single enabled
 * source there is nothing to switch to, so nothing is drawn: a control that
 * cannot change anything is noise above every bookmark, and an unreachable
 * source is already reported by the dashboard's own recovery state, which
 * appears in exactly the cases the old badge turned red.
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
  const activeSource = sources.find((source) => source.id === activeSourceId)

  if (sources.length < 2) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Bookmark source: ${activeSource?.label ?? ""}`}
            className="inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          />
        }
      >
        <span className="truncate">{activeSource?.label}</span>
        {chevron}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Source</DropdownMenuLabel>
          {sources.map((source) => (
            <DropdownMenuItem
              key={source.id}
              disabled={switching || source.id === activeSourceId}
              onClick={() => void switchSource(source.id)}
            >
              {source.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
