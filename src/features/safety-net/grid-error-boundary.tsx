import * as React from "react"
import { Button } from "@/components/ui/button"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"

/**
 * The safety net under the bookmark grid. A render throw anywhere inside it
 * lands here instead of blanking the new tab, so the toolbar, Settings and
 * the way out — a smaller root folder, another source, or safe mode — all
 * stay reachable.
 *
 * A class, because React exposes error boundaries only through
 * `getDerivedStateFromError`; everything with behaviour is in the function
 * component it renders.
 */
interface GridErrorBoundaryState {
  error: Error | null
}

export class GridErrorBoundary extends React.Component<
  { children: React.ReactNode },
  GridErrorBoundaryState
> {
  state: GridErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): GridErrorBoundaryState {
    return {
      error: error instanceof Error ? error : new Error(String(error)),
    }
  }

  render() {
    if (this.state.error) {
      return <GridCrashNotice error={this.state.error} />
    }
    return this.props.children
  }
}

function GridCrashNotice({ error }: { error: Error }) {
  const openSettings = useUIStore((s) => s.openSettings)
  const setSafeMode = usePreferencesStore((s) => s.setSafeMode)
  const [reloading, setReloading] = React.useState(false)

  const reloadInSafeMode = async () => {
    setReloading(true)
    // The preference has to be on disk before the page goes away, or the
    // reload draws the same grid and crashes the same way.
    await setSafeMode(true)
    window.location.reload()
  }

  return (
    <div
      role="alert"
      className="mx-auto flex w-full max-w-md flex-col gap-3 rounded-xl bg-card p-5 text-card-foreground ring-1 ring-border/60"
    >
      <p className="font-medium">The bookmark grid could not be drawn.</p>
      <p className="text-sm text-muted-foreground">
        Settings still work: choose a smaller root folder or another source, or
        reload with the grid switched off.
      </p>
      <pre className="overflow-x-auto rounded-md bg-muted/40 p-3 text-xs break-words whitespace-pre-wrap select-text">
        {error.message || error.name}
      </pre>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={openSettings}>
          Open Settings
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={reloading}
          onClick={() => void reloadInSafeMode()}
        >
          Reload in safe mode
        </Button>
      </div>
    </div>
  )
}
