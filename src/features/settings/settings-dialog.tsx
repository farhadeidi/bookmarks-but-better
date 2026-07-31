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
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { RootFolderSelect } from "@/features/root-folder-select"
import { serializeNetscapeBookmarks } from "@/browser/import-export/netscape-serializer"
import { parseNetscapeBookmarks } from "@/browser/import-export/netscape-parser"
import { isDaemonModeSupported } from "@/browser/daemon"
import { resolveImportRootId } from "./import-target"
import { DaemonConnectionPanel } from "./daemon-connection-panel"
import type { BookmarkNode } from "@/browser"

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

  const handleExport = () => {
    const html = serializeNetscapeBookmarks(tree)
    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "bookmarks.html"
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleShowOnboarding = async () => {
    await adapter?.storage.set("onboardingCompleted", false)
    closeSettings()
    openOnboarding()
  }

  const handleImport = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".html,.htm"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file || !adapter) return

      let targetRootId: string
      try {
        targetRootId = resolveImportRootId(rootFolderId)
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "Import failed.")
        return
      }

      const text = await file.text()
      const imported = parseNetscapeBookmarks(text)

      async function writeNodesParallel(
        nodes: BookmarkNode[],
        parentId: string,
        concurrency = 8
      ): Promise<void> {
        const folders: BookmarkNode[] = []
        const leaves: BookmarkNode[] = []
        for (const node of nodes) {
          if (node.url) leaves.push(node)
          else if (node.children) folders.push(node)
        }

        for (let i = 0; i < leaves.length; i += concurrency) {
          const batch = leaves.slice(i, i + concurrency)
          await Promise.all(
            batch.map((node) =>
              adapter!.bookmarks.create({
                parentId,
                title: node.title,
                url: node.url,
              })
            )
          )
        }

        const createdFolders = await Promise.all(
          folders.map((node) =>
            adapter!.bookmarks.create({ parentId, title: node.title })
          )
        )

        await Promise.all(
          folders.map((node, i) =>
            writeNodesParallel(
              node.children ?? [],
              createdFolders[i].id,
              concurrency
            )
          )
        )
      }

      for (const root of imported) {
        if (root.children) {
          await writeNodesParallel(root.children, targetRootId)
        }
      }

      await refresh()
    }
    input.click()
  }

  return (
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
                  Maximum number of columns in the dashboard grid. Fewer columns
                  are used on smaller screens.
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
                  <Label className="text-sm font-medium">Bookmark Source</Label>
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
                    Use browser bookmarks, manage an independent collection, or
                    connect to a local <code>bbb</code> daemon. Browser and
                    Standalone require a page reload to take effect.
                  </p>
                  {showDaemonPanel && <DaemonConnectionPanel />}
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Bookmarks Data</Label>
                <div className="flex gap-2">
                  {/* The vault is the source of truth in daemon mode, so
                      client-side HTML import isn't offered there yet. */}
                  {import.meta.env.VITE_BUILD_TARGET !== "daemon" && (
                    <Button variant="outline" size="sm" onClick={handleImport}>
                      Import
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={handleExport}>
                    Export
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {import.meta.env.VITE_BUILD_TARGET === "daemon"
                    ? "Export bookmarks as HTML (standard browser format)."
                    : "Import or export bookmarks as HTML (standard browser format)."}
                </p>
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
  )
}
