import * as React from "react"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import type { SourceDescriptor } from "@/sources/descriptors"

function SourceCard({
  source,
  enabled,
  active,
  switching,
  onToggle,
  onActivate,
  children,
}: {
  source: SourceDescriptor
  enabled: boolean
  active: boolean
  switching: boolean
  onToggle: (enabled: boolean) => void
  onActivate: () => void
  children?: React.ReactNode
}) {
  const setSourceLabel = useSourceStore((s) => s.setSourceLabel)
  const [editing, setEditing] = React.useState(false)
  const [draftLabel, setDraftLabel] = React.useState(source.label)
  const [saving, setSaving] = React.useState(false)

  const startEditing = () => {
    setDraftLabel(source.label)
    setEditing(true)
  }

  const saveLabel = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await setSourceLabel(source.id, draftLabel)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-border/60">
      <div className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-sm font-medium">{source.label}</span>
          {source.label !== source.defaultLabel && (
            <span className="truncate text-xs text-muted-foreground">
              Default: {source.defaultLabel}
            </span>
          )}
          {source.kind === "daemon" && source.vaultId && (
            <span className="truncate text-xs text-muted-foreground">
              Vault ID: {source.vaultId}
            </span>
          )}
          {source.kind === "standalone" && (
            <span className="text-sm text-amber-600 dark:text-amber-400">
              {STANDALONE_DEPRECATION_MESSAGE}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Rename ${source.label}`}
            onClick={startEditing}
          >
            Rename
          </Button>
          <Button
            type="button"
            size="sm"
            variant={active ? "default" : "outline"}
            disabled={switching || active}
            onClick={onActivate}
          >
            {active ? "Active" : "Make active"}
          </Button>
          <Switch
            aria-label={`Enable ${source.label}`}
            checked={enabled}
            onCheckedChange={onToggle}
          />
        </div>
      </div>

      {editing && (
        <form
          className="flex flex-col gap-3 border-t border-border/60 bg-muted/20 p-3 sm:flex-row sm:items-end"
          onSubmit={(event) => void saveLabel(event)}
        >
          <Field className="min-w-0 flex-1 gap-1.5">
            <FieldLabel htmlFor={`source-label-${source.id}`}>
              Display label
            </FieldLabel>
            <Input
              id={`source-label-${source.id}`}
              value={draftLabel}
              placeholder={source.defaultLabel}
              disabled={saving}
              autoFocus
              onChange={(event) => setDraftLabel(event.target.value)}
            />
          </Field>
          <div className="flex shrink-0 gap-2">
            <Button type="submit" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save label"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      )}

      {children}
    </div>
  )
}

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
  const forgetDaemon = useSourceStore((s) => s.forgetDaemon)
  const refreshDaemonVaults = useSourceStore((s) => s.refreshDaemonVaults)
  const caps = React.useMemo(() => platformCapabilities(), [])

  const [enableError, setEnableError] = React.useState<string | null>(null)
  const [refreshingOrigin, setRefreshingOrigin] = React.useState<string | null>(
    null
  )

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
  const daemonGroups = React.useMemo(() => {
    const origins = new Set([
      ...Object.keys(config.connections),
      ...daemonSources.map((source) => source.origin ?? ""),
    ])
    return [...origins].sort().map((origin) => ({
      origin,
      sources: daemonSources.filter(
        (source) => (source.origin ?? "") === origin
      ),
    }))
  }, [config.connections, daemonSources])

  const refreshVaults = async (origin: string) => {
    setRefreshingOrigin(origin)
    try {
      await refreshDaemonVaults(origin)
    } finally {
      setRefreshingOrigin(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {localSources.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium">Local sources</Label>
          {localSources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              enabled={Boolean(sourceEntries[source.id]?.enabled)}
              active={source.id === activeSourceId}
              switching={switching}
              onActivate={() => void switchSource(source.id)}
              onToggle={(checked) => void handleToggle(source.id, checked)}
            >
              {source.kind === "browser" && source.id === activeSourceId && (
                <BrowserSourceSettings />
              )}
            </SourceCard>
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
        {daemonGroups.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No daemon connected yet. Each Vault a daemon hosts becomes its own
            source.
          </p>
        )}
        {daemonGroups.map(({ origin, sources: groupSources }) => (
          <section
            key={origin || "same-origin"}
            role="group"
            aria-label={`Daemon ${origin || "this daemon"}`}
            className="flex flex-col gap-3 rounded-xl bg-muted/20 p-3 ring-1 ring-border/60"
          >
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {origin || "This daemon"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {groupSources.length}{" "}
                  {groupSources.length === 1 ? "Vault" : "Vaults"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={refreshingOrigin !== null}
                  onClick={() => void refreshVaults(origin)}
                >
                  {refreshingOrigin === origin
                    ? "Refreshing…"
                    : "Refresh Vaults"}
                </Button>
                {Object.hasOwn(config.connections, origin) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void forgetDaemon(origin)}
                  >
                    Forget daemon
                  </Button>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {groupSources.map((source) => (
                <SourceCard
                  key={source.id}
                  source={source}
                  enabled={Boolean(sourceEntries[source.id]?.enabled)}
                  active={source.id === activeSourceId}
                  switching={switching}
                  onActivate={() => void switchSource(source.id)}
                  onToggle={(checked) => void handleToggle(source.id, checked)}
                />
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              Add, remove, or rename Vaults in the daemon configuration, then
              restart the daemon and refresh this list. Disabling a Vault keeps
              the connection for later.
            </p>
          </section>
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
