import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { buildRootFolderOptions } from "@/features/root-folder-select"
import { serializeNetscapeBookmarks } from "@/browser/import-export/netscape-serializer"
import { parseNetscapeBookmarks } from "@/browser/import-export/netscape-parser"
import { resolveDefaultImportParentId } from "../import-target"
import { executeImportPlan, formatImportResult } from "../import-bookmarks"
import {
  planImport,
  type ConflictResolution,
  type ImportPlan,
} from "../import-plan"
import { ImportConflictDialog } from "../import-conflict-dialog"
import {
  resolveExportTree,
  exportFileName,
  type ExportScope,
} from "../export-scope"
import type { BookmarkNode } from "@/browser"
import { setOnboardingCompleted } from "@/browser/onboarding-preference"
import { useUIStore } from "@/stores/ui-store"
import { platformCapabilities } from "@/sources/platform"
import { SettingGroup, SettingRow, SettingSection } from "./setting-row"

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

export function GeneralPanel() {
  const openOnboarding = useUIStore((s) => s.openOnboarding)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const adapter = useBookmarkStore((s) => s.adapter)
  const safeMode = usePreferencesStore((s) => s.safeMode)
  const setSafeMode = usePreferencesStore((s) => s.setSafeMode)

  const handleShowOnboarding = async () => {
    await Promise.all([
      setOnboardingCompleted(false),
      adapter?.storage.set("onboardingCompleted", false),
    ])
    closeSettings()
    openOnboarding()
  }

  return (
    <div className="flex flex-col gap-8">
      <SettingSection title="Setup">
        <SettingGroup>
          <SettingRow
            title="Setup wizard"
            description="Walk through the first-run setup again, including choosing bookmark sources and a root folder."
            control={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleShowOnboarding()}
              >
                Show setup wizard
              </Button>
            }
          />
        </SettingGroup>
      </SettingSection>
      <SettingSection title="Recovery">
        <SettingGroup>
          <SettingRow
            title="Safe mode"
            description="Open the new tab without drawing the bookmark grid, so a root folder or source that breaks it can be changed here first."
            htmlFor="safe-mode"
            control={
              <Switch
                id="safe-mode"
                checked={safeMode}
                onCheckedChange={(checked) => void setSafeMode(checked)}
              />
            }
          />
        </SettingGroup>
      </SettingSection>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Data & Migration
// ---------------------------------------------------------------------------

/** A parsed file waiting for the user to confirm where it should land. */
interface PendingImport {
  nodes: BookmarkNode[]
  folders: number
  bookmarks: number
}

function summarize(nodes: BookmarkNode[]): {
  folders: number
  bookmarks: number
} {
  let folders = 0
  let bookmarks = 0
  for (const node of nodes) {
    if (node.url) {
      bookmarks += 1
    } else {
      folders += 1
      const nested = summarize(node.children ?? [])
      folders += nested.folders
      bookmarks += nested.bookmarks
    }
  }
  return { folders, bookmarks }
}

export function DataMigrationPanel({
  onMigrateStandalone,
  showStandaloneMigration,
}: {
  onMigrateStandalone: () => void
  showStandaloneMigration: boolean
}) {
  const tree = useBookmarkStore((s) => s.tree)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const adapter = useBookmarkStore((s) => s.adapter)
  const refresh = useBookmarkStore((s) => s.refresh)

  const [pendingImport, setPendingImport] =
    React.useState<PendingImport | null>(null)
  const [importParentId, setImportParentId] = React.useState<string | null>(
    null
  )
  const [importFolderName, setImportFolderName] = React.useState("")
  const [importStatus, setImportStatus] = React.useState<string | null>(null)
  const [isImporting, setIsImporting] = React.useState(false)
  const [activePlan, setActivePlan] = React.useState<{
    plan: ImportPlan
    parentId: string
  } | null>(null)

  const folderOptions = React.useMemo(
    () => buildRootFolderOptions(tree),
    [tree]
  )

  const defaultImportParentId = React.useMemo(
    () =>
      resolveDefaultImportParentId(
        tree,
        rootFolderId,
        adapter?.capabilities.rootIsCreatable ?? false
      ),
    [tree, rootFolderId, adapter]
  )

  const handleExport = (scope: ExportScope) => {
    const exported = resolveExportTree(tree, rootFolderId, scope)
    const html = serializeNetscapeBookmarks(exported)
    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = exportFileName(scope, exported[0]?.title ?? null)
    a.click()
    URL.revokeObjectURL(url)
  }

  const handlePickImportFile = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".html,.htm"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      setImportStatus(null)

      let nodes: BookmarkNode[]
      try {
        nodes = parseNetscapeBookmarks(await file.text()).flatMap(
          (root) => root.children ?? []
        )
      } catch (error) {
        setImportStatus(
          `Could not read that file: ${error instanceof Error ? error.message : String(error)}`
        )
        return
      }

      if (nodes.length === 0) {
        setImportStatus("That file contains no bookmarks.")
        return
      }

      // Ask where it goes only once a file is in hand, so the counts below
      // can tell the user what they are about to import.
      setPendingImport({ nodes, ...summarize(nodes) })
      setImportParentId(defaultImportParentId)
      setImportFolderName("")
    }
    input.click()
  }

  const cancelImport = () => {
    setPendingImport(null)
    setImportFolderName("")
    setActivePlan(null)
  }

  const runPlan = async (
    plan: ImportPlan,
    parentId: string,
    resolutions: Record<string, ConflictResolution>
  ) => {
    if (!adapter) return

    setActivePlan(null)
    setIsImporting(true)
    try {
      const result = await executeImportPlan(
        adapter.bookmarks,
        plan.nodes,
        parentId,
        resolutions
      )
      await refresh()
      setImportStatus(formatImportResult(result))
      setPendingImport(null)
      setImportFolderName("")
    } finally {
      setIsImporting(false)
    }
  }

  const handleConfirmImport = async () => {
    if (!pendingImport || !adapter || !importParentId) return

    setImportStatus(null)

    // The optional subfolder rides along as a plain folder in the tree being
    // imported, so it goes through the same name-merging as everything else
    // instead of blindly creating a second folder of that name.
    const subfolder = importFolderName.trim()
    const nodes: BookmarkNode[] = subfolder
      ? [{ id: "", title: subfolder, children: pendingImport.nodes }]
      : pendingImport.nodes

    const plan = planImport(tree, importParentId, nodes)

    if (plan.conflicts.length > 0) {
      // Nothing has been written yet, so cancelling from here is free.
      setActivePlan({ plan, parentId: importParentId })
      return
    }

    await runPlan(plan, importParentId, {})
  }

  const importDisabledReason = !adapter
    ? "Bookmarks are still loading."
    : !defaultImportParentId
      ? "There is no folder to import into yet. Create one first, or choose a root folder in Bookmarks."
      : null

  return (
    <div className="flex flex-col gap-8">
      <SettingSection title="Bookmarks data">
        <SettingGroup>
          <SettingRow
            title="Import"
            description="Bring in bookmarks from an HTML file (the standard browser format). They land in the active source."
            control={
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={importDisabledReason !== null}
                      onClick={handlePickImportFile}
                    >
                      Import…
                    </Button>
                  }
                />
                {importDisabledReason && (
                  <TooltipContent side="bottom">
                    {importDisabledReason}
                  </TooltipContent>
                )}
              </Tooltip>
            }
          />
          {pendingImport && (
            <div className="flex flex-col gap-2 bg-muted/30 p-4">
              <p className="text-xs text-muted-foreground">
                Found {pendingImport.bookmarks} bookmark
                {pendingImport.bookmarks === 1 ? "" : "s"} in{" "}
                {pendingImport.folders} folder
                {pendingImport.folders === 1 ? "" : "s"}. Choose where to put
                them.
              </p>

              <Select
                value={importParentId ?? ""}
                onValueChange={setImportParentId}
              >
                <SelectTrigger className="w-full">
                  <span className="truncate">
                    {folderOptions.find((f) => f.id === importParentId)
                      ?.label ?? "Select a folder"}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {folderOptions.map((folder) => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Input
                value={importFolderName}
                onChange={(e) => setImportFolderName(e.target.value)}
                placeholder="Optional: import into a new subfolder"
                aria-label="New subfolder name"
                disabled={isImporting}
              />

              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={isImporting || !importParentId}
                  title={
                    importParentId
                      ? undefined
                      : "Pick a destination folder first."
                  }
                  onClick={() => void handleConfirmImport()}
                >
                  {isImporting ? "Importing…" : "Import here"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={isImporting}
                  onClick={cancelImport}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {importStatus && (
            <p role="status" className="p-4 text-xs text-muted-foreground">
              {importStatus}
            </p>
          )}
          <SettingRow
            title="Export"
            description="Save bookmarks as an HTML file you can import into any browser."
            control={
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" size="sm">
                      Export…
                    </Button>
                  }
                />
                <DropdownMenuContent align="end">
                  {/* With no root folder chosen there is nothing to narrow to, so
                      this would hand back the same file as "Everything" — two
                      entries, one outcome. */}
                  <DropdownMenuItem
                    disabled={!rootFolderId}
                    title={
                      rootFolderId
                        ? undefined
                        : "Choose a root folder in Bookmarks to export just that folder."
                    }
                    onClick={() => handleExport("dashboard")}
                  >
                    Dashboard folder
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleExport("everything")}>
                    Everything
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        </SettingGroup>
      </SettingSection>

      {activePlan && (
        <ImportConflictDialog
          conflicts={activePlan.plan.conflicts}
          onCancel={cancelImport}
          onResolve={(resolutions) =>
            void runPlan(activePlan.plan, activePlan.parentId, resolutions)
          }
        />
      )}

      {showStandaloneMigration && (
        <SettingSection title="Legacy Standalone data">
          <SettingGroup>
            <SettingRow
              title="Migrate Standalone bookmarks"
              description="Copy the legacy Standalone collection into the active source or any other. The original data is never deleted and stays readable here for the whole sunset period."
              control={
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onMigrateStandalone}
                >
                  Migrate…
                </Button>
              }
            />
          </SettingGroup>
        </SettingSection>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Advanced
// ---------------------------------------------------------------------------

export function AdvancedPanel() {
  const experimentalCardDrag = usePreferencesStore(
    (s) => s.experimentalCardDrag
  )
  const setExperimentalCardDrag = usePreferencesStore(
    (s) => s.setExperimentalCardDrag
  )

  return (
    <div className="flex flex-col gap-8">
      <SettingSection title="Experiments">
        <SettingGroup>
          <SettingRow
            title="Experimental card drag"
            description="Enable the in-progress card-to-card drag affordance in the grid."
            htmlFor="experimental-card-drag"
            control={
              <Switch
                id="experimental-card-drag"
                checked={experimentalCardDrag}
                onCheckedChange={(checked) => setExperimentalCardDrag(checked)}
              />
            }
          />
        </SettingGroup>
      </SettingSection>
    </div>
  )
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

export function AboutPanel() {
  const caps = React.useMemo(() => platformCapabilities(), [])

  return (
    <div className="flex flex-col gap-8">
      <SettingSection title="This build">
        <SettingGroup>
          <SettingRow
            title="Bookmarks — But Better"
            description={`Version ${__APP_VERSION__}`}
            control={
              <span className="text-xs text-muted-foreground">
                {caps.buildTarget}
              </span>
            }
          />
          <SettingRow
            title="Browser Source"
            description="Bookmarks kept by this browser profile."
            control={
              <span className="text-xs text-muted-foreground">
                {caps.browserSource ? "Available" : "Unavailable"}
              </span>
            }
          />
          <SettingRow
            title="Daemon Sources"
            description="Vaults served by a local daemon."
            control={
              <span className="text-xs text-muted-foreground">
                {caps.daemonSource ? "Available" : "Unavailable"}
              </span>
            }
          />
        </SettingGroup>
      </SettingSection>
      <SettingSection title="Links">
        <SettingGroup>
          <SettingRow
            title="Extension listing"
            control={
              <a
                href="https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=extension-info"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                Chrome Web Store
              </a>
            }
          />
          <SettingRow
            title="Source code"
            control={
              <a
                href="https://github.com/farhadeidi/bookmarks-but-better"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                GitHub
              </a>
            }
          />
        </SettingGroup>
      </SettingSection>
    </div>
  )
}
