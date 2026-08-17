import * as React from "react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { allSourceDescriptors, useSourceStore } from "@/stores/source-store"
import { platformCapabilities } from "@/sources/platform"
import { STANDALONE_DEPRECATION_MESSAGE } from "@/features/standalone-sunset"
import { DaemonConnectionPanel } from "../daemon-connection-panel"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { RootFolderSelect } from "@/features/root-folder-select"

function BrowserSourceSettings() {
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const setNestedFolders = usePreferencesStore((s) => s.setNestedFolders)

  return (
    <div className="flex flex-col gap-5 border-t border-border/60 bg-muted/20 p-4">
      <RootFolderSelect
        value={rootFolderId}
        onChange={setRootFolderId}
        label="Root folder"
        description="Choose which Browser bookmarks folder appears on the dashboard."
      />

      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <Label className="text-sm font-medium">Nested folders</Label>
          <p className="text-sm text-muted-foreground">
            Show Browser bookmark subfolders inside their parent cards.
          </p>
        </div>
        <Switch
          className="shrink-0"
          aria-label="Show nested Browser bookmark folders"
          checked={nestedFolders}
          onCheckedChange={setNestedFolders}
        />
      </div>
    </div>
  )
}

/**
 * The Sources category: every source this profile knows, its enabled state,
 * which one is Active, and the daemon connections underneath them.
 *
 * Enable/disable retains configuration and is always reversible; Forget is a
 * separate, destructive-looking action confined to daemon connections. The
 * two are never conflated — disabling a Vault keeps its address and token,
 * forgetting the connection is what discards them.
 */
export function SourcesPanel({
  onMigrateStandalone,
}: {
  onMigrateStandalone: () => void
}) {
  // Derived from the config reference so the descriptor list is referentially
  // stable between config changes.
  const config = useSourceStore((s) => s.config)
  const sources = React.useMemo(
    () => allSourceDescriptors({ config }),
    [config]
  )
  const sourceEntries = useSourceStore((s) => s.config.sources)
  const activeSourceId = useSourceStore((s) => s.activeSourceId)
  const switching = useSourceStore((s) => s.switching)
  const setSourceEnabled = useSourceStore((s) => s.setSourceEnabled)
  const switchSource = useSourceStore((s) => s.switchSource)
  const caps = React.useMemo(() => platformCapabilities(), [])

  const [enableError, setEnableError] = React.useState<string | null>(null)

  const handleToggle = async (id: string, enabled: boolean) => {
    setEnableError(null)
    const applied = await setSourceEnabled(id, enabled)
    if (!applied) {
      setEnableError(
        "At least one source must stay enabled. Forget a daemon connection instead, or keep this one."
      )
    }
  }

  const daemonSources = sources.filter((source) => source.kind === "daemon")
  const localSources = sources.filter((source) => source.kind !== "daemon")

  return (
    <div className="flex flex-col gap-6">
      {localSources.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium">Local sources</Label>
          {localSources.map((source) => (
            <div
              key={source.id}
              className="overflow-hidden rounded-xl bg-card ring-1 ring-border/60"
            >
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-sm font-medium">
                    {source.label}
                  </span>
                  {source.kind === "standalone" && (
                    <span className="text-sm text-amber-600 dark:text-amber-400">
                      {STANDALONE_DEPRECATION_MESSAGE}
                    </span>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    variant={
                      source.id === activeSourceId ? "default" : "outline"
                    }
                    disabled={switching || source.id === activeSourceId}
                    onClick={() => void switchSource(source.id)}
                  >
                    {source.id === activeSourceId ? "Active" : "Make active"}
                  </Button>
                  <Switch
                    aria-label={`Enable ${source.label}`}
                    checked={Boolean(sourceEntries[source.id]?.enabled)}
                    onCheckedChange={(checked) =>
                      void handleToggle(source.id, checked)
                    }
                  />
                </div>
              </div>
              {source.kind === "browser" && source.id === activeSourceId && (
                <BrowserSourceSettings />
              )}
            </div>
          ))}
          {sources.some((s) => s.kind === "standalone") && (
            <Button
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={onMigrateStandalone}
            >
              Migrate Standalone bookmarks…
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Daemon sources</Label>
        {daemonSources.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No daemon connected yet. Each Vault a daemon hosts becomes its own
            source.
          </p>
        )}
        {daemonSources.map((source) => (
          <div
            key={source.id}
            className="flex items-center justify-between gap-3 rounded-xl bg-card p-3 ring-1 ring-border/60"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate text-sm font-medium">
                {source.label}
              </span>
              <span className="truncate text-sm text-muted-foreground">
                {source.origin}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="sm"
                variant={source.id === activeSourceId ? "default" : "outline"}
                disabled={switching || source.id === activeSourceId}
                onClick={() => void switchSource(source.id)}
              >
                {source.id === activeSourceId ? "Active" : "Make active"}
              </Button>
              <Switch
                aria-label={`Enable ${source.label}`}
                checked={Boolean(sourceEntries[source.id]?.enabled)}
                onCheckedChange={(checked) =>
                  void handleToggle(source.id, checked)
                }
              />
            </div>
          </div>
        ))}
      </div>

      {enableError && (
        <Alert variant="destructive">
          <AlertTitle>Cannot disable</AlertTitle>
          <AlertDescription>{enableError}</AlertDescription>
        </Alert>
      )}

      {caps.daemonSource && <DaemonConnectionPanel />}

      <p className="text-sm text-muted-foreground">
        Source Configuration is local to this browser profile and is never
        synced. Exactly one enabled source is the Active Source across the
        dashboard, the capture popup and the omnibox.
      </p>
    </div>
  )
}
