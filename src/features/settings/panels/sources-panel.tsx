import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Add01Icon,
  MoreVerticalIcon,
  PencilEdit01Icon,
} from "@hugeicons/core-free-icons"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { allSourceDescriptors, useSourceStore } from "@/stores/source-store"
import { platformCapabilities } from "@/sources/platform"
import { STANDALONE_DEPRECATION_MESSAGE } from "@/features/standalone-sunset"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { RootFolderSelect } from "@/features/root-folder-select"
import type { SourceDescriptor } from "@/sources/descriptors"
import { cn } from "@/lib/utils"
import { DaemonConnectionPanel } from "../daemon-connection-panel"
import { SettingGroup, SettingRow, SettingSection } from "./setting-row"

type DaemonStatus = "checking" | "connected" | "unreachable"

/**
 * One source as a row: its name (with the default it replaces, once renamed),
 * whether it is the Active Source or can become it, and whether it is
 * enabled. Renaming opens an inline form under the row.
 */
function SourceRow({
  source,
  enabled,
  active,
  switching,
  onToggle,
  onActivate,
  note,
}: {
  source: SourceDescriptor
  enabled: boolean
  active: boolean
  switching: boolean
  onToggle: (enabled: boolean) => void
  onActivate: () => void
  note?: React.ReactNode
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
    <div>
      <div className="flex items-center gap-3 p-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1">
            <span className="truncate text-sm font-medium">{source.label}</span>
            <Button
              type="button"
              size="icon-xs"
              variant="ghost"
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={`Rename ${source.label}`}
              title="Rename"
              onClick={startEditing}
            >
              <HugeiconsIcon icon={PencilEdit01Icon} strokeWidth={2} />
            </Button>
          </div>
          {source.label !== source.defaultLabel && (
            <span className="truncate text-xs text-muted-foreground">
              {source.defaultLabel}
            </span>
          )}
          {note}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {active ? (
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
              Active
            </span>
          ) : (
            <Button
              type="button"
              size="xs"
              variant="outline"
              disabled={switching}
              aria-label={`Use ${source.label}`}
              onClick={onActivate}
            >
              Use
            </Button>
          )}
          <Switch
            aria-label={`Enable ${source.label}`}
            checked={enabled}
            onCheckedChange={onToggle}
          />
        </div>
      </div>

      {editing && (
        <form
          className="flex flex-col gap-3 border-t border-border/60 bg-muted/20 p-4 sm:flex-row sm:items-end"
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
    </div>
  )
}

const STATUS_TEXT: Record<DaemonStatus, string> = {
  checking: "Checking…",
  connected: "Connected",
  unreachable: "Unreachable",
}

/**
 * One daemon connection: a header that says whether the daemon answers right
 * now, its Vaults as rows, and the connection-level actions behind a menu.
 * Forget is destructive and sits apart from Refresh; an unreachable daemon
 * gets its Retry in the open.
 */
function DaemonCard({
  origin,
  vaultCount,
  status,
  canForget,
  onRefresh,
  onForget,
  children,
}: {
  origin: string
  vaultCount: number
  status: DaemonStatus
  canForget: boolean
  onRefresh: () => void
  onForget: () => void
  children: React.ReactNode
}) {
  const name = origin || "This daemon"
  const vaults = `${vaultCount} ${vaultCount === 1 ? "Vault" : "Vaults"}`

  return (
    <section
      role="group"
      aria-label={`Daemon ${origin || "this daemon"}`}
      className="overflow-hidden rounded-xl bg-card ring-1 ring-border/60"
    >
      <div className="flex items-center gap-3 border-b border-border/60 bg-muted/30 py-3 pr-2 pl-4">
        <span
          aria-hidden
          className={cn(
            "size-2 shrink-0 rounded-full",
            status === "connected" && "bg-emerald-500",
            status === "unreachable" && "bg-destructive",
            status === "checking" && "animate-pulse bg-muted-foreground/50"
          )}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{name}</span>
          <span
            className={cn(
              "text-xs",
              status === "unreachable"
                ? "text-destructive"
                : "text-muted-foreground"
            )}
          >
            {STATUS_TEXT[status]} · {vaults}
          </span>
        </div>
        {status === "unreachable" && (
          <Button type="button" size="xs" variant="outline" onClick={onRefresh}>
            Retry
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Actions for daemon ${origin || "this daemon"}`}
              />
            }
          >
            <HugeiconsIcon icon={MoreVerticalIcon} strokeWidth={2} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-auto min-w-44">
            <DropdownMenuItem
              disabled={status === "checking"}
              onClick={onRefresh}
            >
              Refresh Vaults
            </DropdownMenuItem>
            {canForget && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onForget}>
                  Forget daemon
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {status === "unreachable" && (
        <p className="border-b border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
          Not answering. Run <code>npx bookmarks-but-better@latest status</code>{" "}
          to see why and how to fix it.
        </p>
      )}

      <div className="divide-y divide-border/60">{children}</div>

      <p className="border-t border-border/60 px-4 py-3 text-xs text-muted-foreground">
        Add or remove Vaults with{" "}
        <code>npx bookmarks-but-better@latest vault</code>, then Refresh.
        Disabling a Vault here keeps it for later.
      </p>
    </section>
  )
}

/**
 * The Sources category, in sections: the Browser Source with the settings
 * that belong to it, each daemon connection with its Vaults and live status,
 * connecting a daemon, and — only for profiles still on it — the legacy
 * Standalone source.
 *
 * Enable/disable retains configuration and is always reversible; Forget is a
 * separate, destructive action confined to daemon connections. The two are
 * never conflated — disabling a Vault keeps its address and token, forgetting
 * the connection is what discards them.
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
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const setNestedFolders = usePreferencesStore((s) => s.setNestedFolders)
  const caps = React.useMemo(() => platformCapabilities(), [])

  const [enableError, setEnableError] = React.useState<string | null>(null)
  const [connectOpen, setConnectOpen] = React.useState(false)

  const browserSource = sources.find((source) => source.kind === "browser")
  const standaloneSource = sources.find(
    (source) => source.kind === "standalone"
  )
  const daemonSources = sources.filter((source) => source.kind === "daemon")
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

  // Which daemons answered the last check, and which one is being re-checked.
  // Opening Sources with connections checks them all once; `null` means that
  // first check has not come back yet.
  const [checkOnOpen] = React.useState(() => daemonGroups.length > 0)
  const [reachable, setReachable] = React.useState<Set<string> | null>(() =>
    checkOnOpen ? null : new Set()
  )
  const [checkingOrigin, setCheckingOrigin] = React.useState<string | null>(
    null
  )

  const checkDaemons = React.useCallback(
    async (origin?: string) => {
      if (origin !== undefined) setCheckingOrigin(origin)
      let answered: string[] = []
      try {
        answered = await refreshDaemonVaults(origin)
      } catch {
        // A failed check reads the same as a daemon that did not answer.
      }
      setReachable((previous) => {
        const next = new Set(origin === undefined ? [] : (previous ?? []))
        if (origin !== undefined) next.delete(origin)
        for (const found of answered) next.add(found)
        return next
      })
      setCheckingOrigin(null)
    },
    [refreshDaemonVaults]
  )

  React.useEffect(() => {
    if (checkOnOpen) void checkDaemons()
  }, [checkOnOpen, checkDaemons])

  const statusOf = (origin: string): DaemonStatus => {
    if (reachable === null || checkingOrigin === origin) return "checking"
    return reachable.has(origin) ? "connected" : "unreachable"
  }

  const handleToggle = async (id: string, enabled: boolean) => {
    setEnableError(null)
    const applied = await setSourceEnabled(id, enabled)
    if (!applied) {
      setEnableError(
        "At least one source must stay enabled. Forget a daemon connection instead, or keep this one."
      )
    }
  }

  const rowProps = (source: SourceDescriptor) => ({
    source,
    enabled: Boolean(sourceEntries[source.id]?.enabled),
    active: source.id === activeSourceId,
    switching,
    onActivate: () => void switchSource(source.id),
    onToggle: (checked: boolean) => void handleToggle(source.id, checked),
  })

  const showDaemons = daemonGroups.length > 0 || caps.daemonSource

  return (
    <div className="flex flex-col gap-8">
      {enableError && (
        <Alert variant="destructive">
          <AlertTitle>Cannot disable</AlertTitle>
          <AlertDescription>{enableError}</AlertDescription>
        </Alert>
      )}

      {browserSource && (
        <SettingSection title="Browser">
          <SettingGroup>
            <SourceRow {...rowProps(browserSource)} />
            {/* The root folder is chosen from the tree the dashboard shows,
                so these apply while the Browser Source is the active one. */}
            {browserSource.id === activeSourceId ? (
              <>
                <div className="p-4">
                  <RootFolderSelect
                    value={rootFolderId}
                    onChange={setRootFolderId}
                    label="Root folder"
                    description="Which folder the dashboard starts from."
                  />
                </div>
                <SettingRow
                  title="Nested folders"
                  description="Show subfolders inside their parent cards."
                  control={
                    <Switch
                      aria-label="Show nested Browser bookmark folders"
                      checked={nestedFolders}
                      onCheckedChange={setNestedFolders}
                    />
                  }
                />
              </>
            ) : (
              <p className="p-4 text-xs text-muted-foreground">
                Root folder and nested folders can be set while Browser
                bookmarks is the active source.
              </p>
            )}
          </SettingGroup>
        </SettingSection>
      )}

      {showDaemons && (
        <SettingSection title="Daemons">
          {daemonGroups.map(({ origin, sources: groupSources }) => (
            <DaemonCard
              key={origin || "same-origin"}
              origin={origin}
              vaultCount={groupSources.length}
              status={statusOf(origin)}
              canForget={Object.hasOwn(config.connections, origin)}
              onRefresh={() => void checkDaemons(origin)}
              onForget={() => void forgetDaemon(origin)}
            >
              {groupSources.map((source) => (
                <SourceRow key={source.id} {...rowProps(source)} />
              ))}
            </DaemonCard>
          ))}

          {caps.daemonSource &&
            (daemonGroups.length === 0 || connectOpen ? (
              <div className="rounded-xl bg-card p-4 ring-1 ring-border/60">
                <DaemonConnectionPanel
                  firstConnection={daemonGroups.length === 0}
                  onConnected={(origin) => {
                    setConnectOpen(false)
                    setReachable(
                      (previous) => new Set([...(previous ?? []), origin])
                    )
                  }}
                />
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setConnectOpen(true)}
              >
                <HugeiconsIcon icon={Add01Icon} strokeWidth={2} />
                Connect another daemon
              </Button>
            ))}
        </SettingSection>
      )}

      {standaloneSource && (
        <SettingSection title="Legacy">
          <SettingGroup>
            <SourceRow
              {...rowProps(standaloneSource)}
              note={
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {STANDALONE_DEPRECATION_MESSAGE}
                </span>
              }
            />
            <div className="p-4">
              <Button variant="outline" size="sm" onClick={onMigrateStandalone}>
                Migrate Standalone bookmarks…
              </Button>
            </div>
          </SettingGroup>
        </SettingSection>
      )}

      <p className="text-xs text-muted-foreground">
        Sources are set per browser profile and never synced. One enabled source
        at a time backs the dashboard, the capture popup and the omnibox.
      </p>
    </div>
  )
}
