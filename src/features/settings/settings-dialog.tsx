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
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useTheme } from "@/components/theme-provider"
import { RootFolderPicker } from "./root-folder-picker"
import { serializeNetscapeBookmarks } from "@/browser/import-export/netscape-serializer"
import { parseNetscapeBookmarks } from "@/browser/import-export/netscape-parser"
import type { BookmarkNode } from "@/browser"

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const setNestedFolders = usePreferencesStore((s) => s.setNestedFolders)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const tree = useBookmarkStore((s) => s.tree)
  const adapter = useBookmarkStore((s) => s.adapter)
  const refresh = useBookmarkStore((s) => s.refresh)
  const adapterMode = usePreferencesStore((s) => s.adapterMode)
  const setAdapterMode = usePreferencesStore((s) => s.setAdapterMode)
  const { theme, setTheme } = useTheme()

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

      async function writeNode(
        node: BookmarkNode,
        parentId: string
      ): Promise<void> {
        if (node.url) {
          await adapter!.bookmarks.create({
            parentId,
            title: node.title,
            url: node.url,
          })
        } else if (node.children) {
          const folder = await adapter!.bookmarks.create({
            parentId,
            title: node.title,
          })
          for (const child of node.children) {
            await writeNode(child, folder.id)
          }
        }
      }

      const rootId = rootFolderId ?? "0"
      for (const root of imported) {
        if (root.children) {
          for (const child of root.children) {
            await writeNode(child, rootId)
          }
        }
      }

      await refresh()
    }
    input.click()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) closeSettings() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your bookmarks dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
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
            <Label className="text-sm font-medium">Theme</Label>
            <div className="flex gap-2">
              {(["light", "dark", "system"] as const).map((t) => (
                <Button
                  key={t}
                  variant={theme === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme(t)}
                  className="capitalize"
                >
                  {t}
                </Button>
              ))}
            </div>
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
      </DialogContent>
    </Dialog>
  )
}
