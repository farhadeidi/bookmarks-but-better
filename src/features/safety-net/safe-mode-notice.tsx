import { Button } from "@/components/ui/button"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"

/**
 * What the new tab shows in place of the grid while safe mode is on. The
 * bookmark tree is still loaded — Settings needs it to offer root folders —
 * but nothing lays it out until the person asks.
 */
export function SafeModeNotice() {
  const openSettings = useUIStore((s) => s.openSettings)
  const setSafeMode = usePreferencesStore((s) => s.setSafeMode)

  return (
    <div
      role="status"
      className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-xl bg-card p-5 text-card-foreground ring-1 ring-border/60"
    >
      <p className="font-medium">
        Safe mode is on: bookmarks are not rendered.
      </p>
      <p className="text-sm text-muted-foreground">
        Change the root folder or the active source in Settings, then turn safe
        mode off to draw the grid again.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={openSettings}>
          Open Settings
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void setSafeMode(false)}
        >
          Turn safe mode off
        </Button>
      </div>
    </div>
  )
}
