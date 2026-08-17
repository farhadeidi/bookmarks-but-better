import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import {
  usePreferencesStore,
  COLOR_THEMES,
  type ColorTheme,
} from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useTheme } from "@/components/theme-provider"
import {
  RootFolderSelect,
  buildRootFolderOptions,
} from "@/features/root-folder-select"
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

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

export function GeneralPanel() {
  const openOnboarding = useUIStore((s) => s.openOnboarding)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const adapter = useBookmarkStore((s) => s.adapter)

  const handleShowOnboarding = async () => {
    await Promise.all([
      setOnboardingCompleted(false),
      adapter?.storage.set("onboardingCompleted", false),
    ])
    closeSettings()
    openOnboarding()
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Setup wizard</Label>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleShowOnboarding()}
          >
            Show setup wizard
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Walk through the first-run setup again, including choosing bookmark
          sources and a root folder.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Appearance
// ---------------------------------------------------------------------------

export function AppearancePanel() {
  const colorTheme = usePreferencesStore((s) => s.colorTheme)
  const setColorTheme = usePreferencesStore((s) => s.setColorTheme)
  const maxColumns = usePreferencesStore((s) => s.maxColumns)
  const setMaxColumns = usePreferencesStore((s) => s.setMaxColumns)
  const containerMode = usePreferencesStore((s) => s.containerMode)
  const setContainerMode = usePreferencesStore((s) => s.setContainerMode)
  const { theme, setTheme } = useTheme()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Light / dark</Label>
        <Select
          value={theme}
          onValueChange={(value) =>
            setTheme(value as "light" | "dark" | "system")
          }
        >
          <SelectTrigger className="w-full">
            <span className="capitalize">{theme}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="light">Light</SelectItem>
            <SelectItem value="dark">Dark</SelectItem>
            <SelectItem value="system">System</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Applies to this browser profile on every source.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Color theme</Label>
        <Select
          value={colorTheme}
          onValueChange={(value) => setColorTheme(value as ColorTheme)}
        >
          <SelectTrigger className="w-full">
            <span className="capitalize">{colorTheme}</span>
          </SelectTrigger>
          <SelectContent>
            {COLOR_THEMES.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Max columns</Label>
        <Select
          value={String(maxColumns)}
          onValueChange={(val) => setMaxColumns(Number(val))}
        >
          <SelectTrigger className="w-full">
            <span>{maxColumns} columns</span>
          </SelectTrigger>
          <SelectContent>
            {[2, 3, 4, 5, 6].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} columns
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Maximum number of columns in the dashboard grid. Fewer columns are
          used on smaller screens.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Container</Label>
        <Select
          value={containerMode}
          onValueChange={(val) =>
            setContainerMode(val as "fluid" | "contained")
          }
        >
          <SelectTrigger className="w-full">
            <span>{containerMode === "fluid" ? "Fluid" : "Contained"}</span>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fluid">Fluid</SelectItem>
            <SelectItem value="contained">Contained</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Contained limits the dashboard to 1440px wide and centers it on the
          screen.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bookmarks
// ---------------------------------------------------------------------------

export function BookmarksPanel() {
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const setNestedFolders = usePreferencesStore((s) => s.setNestedFolders)

  return (
    <div className="flex flex-col gap-6">
      <RootFolderSelect
        value={rootFolderId}
        onChange={setRootFolderId}
        label="Root folder"
        description="Choose which folder to display as the root of your bookmarks. This choice belongs to the active source."
      />

      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Label className="text-sm font-medium">Nested folders</Label>
          <p className="text-xs text-muted-foreground">
            Show subfolders inside their parent cards.
          </p>
        </div>
        <Switch
          checked={nestedFolders}
          onCheckedChange={(checked) => setNestedFolders(checked)}
        />
      </div>
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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium">Bookmarks data</Label>
        <div className="flex gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!adapter || !defaultImportParentId}
                  onClick={handlePickImportFile}
                >
                  Import
                </Button>
              }
            />
            {!adapter || !defaultImportParentId ? (
              <TooltipContent side="bottom">
                {adapter
                  ? "There is no folder to import into yet. Create one first, or choose a root folder in Bookmarks."
                  : "Bookmarks are still loading."}
              </TooltipContent>
            ) : null}
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="outline" size="sm">
                  Export
                </Button>
              }
            />
            <DropdownMenuContent align="start">
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
        </div>
        <p className="text-xs text-muted-foreground">
          Import or export bookmarks as HTML (standard browser format). Imports
          land in the active source.
        </p>

        {pendingImport && (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border/70 p-3">
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
                  {folderOptions.find((f) => f.id === importParentId)?.label ??
                    "Select a folder"}
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
          <p role="status" className="text-xs text-muted-foreground">
            {importStatus}
          </p>
        )}
      </div>

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
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium">Legacy Standalone data</Label>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onMigrateStandalone}>
              Migrate Standalone bookmarks…
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Copy the legacy Standalone collection into the active source or any
            other. The original data is never deleted and stays readable here
            for the whole sunset period.
          </p>
        </div>
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
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-1">
        <Label className="text-sm font-medium">Experimental card drag</Label>
        <p className="text-xs text-muted-foreground">
          Enable the in-progress card-to-card drag affordance in the grid.
        </p>
      </div>
      <Switch
        checked={experimentalCardDrag}
        onCheckedChange={(checked) => setExperimentalCardDrag(checked)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// About
// ---------------------------------------------------------------------------

export function AboutPanel() {
  const caps = React.useMemo(() => platformCapabilities(), [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Bookmarks — But Better</span>
        <span className="text-xs text-muted-foreground">
          Version {__APP_VERSION__}
        </span>
      </div>
      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span>Build: {caps.buildTarget}</span>
        <span>
          Browser Source: {caps.browserSource ? "available" : "unavailable"}
        </span>
        <span>
          Daemon Sources: {caps.daemonSource ? "available" : "unavailable"}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <a
          href="https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=extension-info"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          Chrome Web Store
        </a>
        <a
          href="https://github.com/farhadeidi/bookmarks-but-better"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          GitHub
        </a>
      </div>
    </div>
  )
}
