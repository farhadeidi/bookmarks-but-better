import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import {
  RootFolderSelect,
  buildRootFolderOptions,
} from "@/features/root-folder-select"
import { serializeNetscapeBookmarks } from "@/browser/import-export/netscape-serializer"
import { parseNetscapeBookmarks } from "@/browser/import-export/netscape-parser"
import { isDaemonModeSupported } from "@/browser/daemon"
import { resolveDefaultImportParentId } from "./import-target"
import { executeImportPlan, formatImportResult } from "./import-bookmarks"
import {
  planImport,
  type ConflictResolution,
  type ImportPlan,
} from "./import-plan"
import { ImportConflictDialog } from "./import-conflict-dialog"
import {
  resolveExportTree,
  exportFileName,
  type ExportScope,
} from "./export-scope"
import { DaemonConnectionPanel } from "./daemon-connection-panel"
import type { BookmarkNode } from "@/browser"

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

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const openOnboarding = useUIStore((s) => s.openOnboarding)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const setNestedFolders = usePreferencesStore((s) => s.setNestedFolders)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const tree = useBookmarkStore((s) => s.tree)
  const adapter = useBookmarkStore((s) => s.adapter)
  const refresh = useBookmarkStore((s) => s.refresh)
  const adapterMode = usePreferencesStore((s) => s.adapterMode)
  const setAdapterMode = usePreferencesStore((s) => s.setAdapterMode)
  // Selecting "Daemon" only reveals the connection panel below — persisting
  // the mode happens exclusively through its own Connect flow, which
  // validates, asks for permission and health-checks first. Browser and
  // Standalone keep switching immediately, as they always have.
  const [daemonSelected, setDaemonSelected] = React.useState(false)
  const showDaemonPanel = adapterMode === "daemon" || daemonSelected
  const daemonModeSupported = React.useMemo(() => isDaemonModeSupported(), [])
  const maxColumns = usePreferencesStore((s) => s.maxColumns)
  const setMaxColumns = usePreferencesStore((s) => s.setMaxColumns)
  const containerMode = usePreferencesStore((s) => s.containerMode)
  const setContainerMode = usePreferencesStore((s) => s.setContainerMode)

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

  const handleShowOnboarding = async () => {
    await adapter?.storage.set("onboardingCompleted", false)
    closeSettings()
    openOnboarding()
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
    <>
      {activePlan && (
        <ImportConflictDialog
          conflicts={activePlan.plan.conflicts}
          onCancel={cancelImport}
          onResolve={(resolutions) =>
            void runPlan(activePlan.plan, activePlan.parentId, resolutions)
          }
        />
      )}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (!o) closeSettings()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Configure your bookmarks dashboard.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-4 no-scrollbar max-h-[50vh] overflow-y-auto px-4">
            <div className="flex flex-col gap-6">
              {/* Bookmarks section */}
              <RootFolderSelect
                value={rootFolderId}
                onChange={setRootFolderId}
                label="Root Folder"
                description="Choose which folder to display as the root of your bookmarks."
              />

              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-1">
                  <Label className="text-sm font-medium">Nested Folders</Label>
                  <p className="text-xs text-muted-foreground">
                    Show subfolders inside their parent cards.
                  </p>
                </div>
                <Switch
                  checked={nestedFolders}
                  onCheckedChange={(checked) => setNestedFolders(checked)}
                />
              </div>

              {/* Layout section */}
              <div className="flex flex-col gap-4">
                <div className="border-t pt-4">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Layout
                  </span>
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium">Max Columns</Label>
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
                    Maximum number of columns in the dashboard grid. Fewer
                    columns are used on smaller screens.
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
                      <span>
                        {containerMode === "fluid" ? "Fluid" : "Contained"}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="fluid">Fluid</SelectItem>
                      <SelectItem value="contained">Contained</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Contained limits the dashboard to 1440px wide and centers it
                    on the screen.
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="border-t pt-4">
                  <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                    Data
                  </span>
                </div>

                {/* Adapter mode: not applicable in the daemon build, which always
                  serves its own same-origin daemon adapter. */}
                {import.meta.env.VITE_BUILD_TARGET !== "daemon" && (
                  <div className="flex flex-col gap-2">
                    <Label className="text-sm font-medium">
                      Bookmark Source
                    </Label>
                    <div className="flex gap-2">
                      {(["browser", "standalone"] as const).map((mode) => (
                        <Button
                          key={mode}
                          variant={
                            adapterMode === mode && !daemonSelected
                              ? "default"
                              : "outline"
                          }
                          size="sm"
                          onClick={() => {
                            setDaemonSelected(false)
                            setAdapterMode(mode)
                          }}
                          className="capitalize"
                        >
                          {mode === "browser" ? "Browser" : "Standalone"}
                        </Button>
                      ))}
                      {/* Hidden rather than shown-and-broken on a mobile
                        browser: there is no local daemon to reach there. */}
                      {daemonModeSupported && (
                        <Button
                          variant={showDaemonPanel ? "default" : "outline"}
                          size="sm"
                          onClick={() => setDaemonSelected(true)}
                        >
                          Daemon
                        </Button>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Use browser bookmarks, manage an independent collection,
                      or connect to a local <code>bbb</code> daemon. Browser and
                      Standalone require a page reload to take effect.
                    </p>
                    {showDaemonPanel && <DaemonConnectionPanel />}
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium">Bookmarks Data</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!adapter || !defaultImportParentId}
                      onClick={handlePickImportFile}
                    >
                      Import
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="outline" size="sm">
                            Export
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="start">
                        <DropdownMenuItem
                          onClick={() => handleExport("dashboard")}
                        >
                          Dashboard folder
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleExport("everything")}
                        >
                          Everything
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Import or export bookmarks as HTML (standard browser
                    format).
                  </p>

                  {pendingImport && (
                    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border/70 p-3">
                      <p className="text-xs text-muted-foreground">
                        Found {pendingImport.bookmarks} bookmark
                        {pendingImport.bookmarks === 1 ? "" : "s"} in{" "}
                        {pendingImport.folders} folder
                        {pendingImport.folders === 1 ? "" : "s"}. Choose where
                        to put them.
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

                <div className="flex flex-col gap-2">
                  <Label className="text-sm font-medium">Setup Wizard</Label>
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
                    Walk through the first-run setup again, including choosing a
                    bookmark source and a root folder.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
