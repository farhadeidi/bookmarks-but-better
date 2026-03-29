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
import { RootFolderPicker } from "./root-folder-picker"
import { serializeNetscapeBookmarks } from "@/browser/import-export/netscape-serializer"
import { parseNetscapeBookmarks } from "@/browser/import-export/netscape-parser"
import type { BookmarkNode } from "@/browser"

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const openFolderOrder = useUIStore((s) => s.openFolderOrder)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const setNestedFolders = usePreferencesStore((s) => s.setNestedFolders)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const tree = useBookmarkStore((s) => s.tree)
  const adapter = useBookmarkStore((s) => s.adapter)
  const refresh = useBookmarkStore((s) => s.refresh)
  const adapterMode = usePreferencesStore((s) => s.adapterMode)
  const setAdapterMode = usePreferencesStore((s) => s.setAdapterMode)
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

  const handleImport = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".html,.htm"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file || !adapter) return

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

      const rootId = rootFolderId ?? "0"
      for (const root of imported) {
        if (root.children) {
          await writeNodesParallel(root.children, rootId)
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
            <RootFolderPicker value={rootFolderId} onChange={setRootFolderId} />

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

            <div className="flex items-center justify-between">
              <div className="flex flex-col gap-1">
                <Label className="text-sm font-medium">Folder Order</Label>
                <p className="text-xs text-muted-foreground">
                  Set the display order of your folder cards.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  closeSettings()
                  openFolderOrder()
                }}
              >
                Reorder
              </Button>
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

            {/* Data section */}
            <div className="flex flex-col gap-4">
              <div className="border-t pt-4">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  Data
                </span>
              </div>

              {/* Adapter mode */}
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Bookmark Source</Label>
                <div className="flex gap-2">
                  {(["browser", "standalone"] as const).map((mode) => (
                    <Button
                      key={mode}
                      variant={adapterMode === mode ? "default" : "outline"}
                      size="sm"
                      onClick={() => setAdapterMode(mode)}
                      className="capitalize"
                    >
                      {mode === "browser" ? "Browser" : "Standalone"}
                    </Button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Use browser bookmarks or manage an independent collection.
                  Requires a page reload to take effect.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium">Bookmarks Data</Label>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={handleImport}>
                    Import
                  </Button>
                  <Button variant="outline" size="sm" onClick={handleExport}>
                    Export
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Import or export bookmarks as HTML (standard browser format).
                </p>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
