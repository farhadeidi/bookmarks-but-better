import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useUIStore } from "@/stores/ui-store"
import { useBookmarkStore } from "@/stores/bookmark-store"

export function BookmarkEditorDialog() {
  const editingBookmark = useUIStore((s) => s.editingBookmark)
  const closeEditor = useUIStore((s) => s.closeEditor)
  const updateBookmark = useBookmarkStore((s) => s.updateBookmark)

  const [title, setTitle] = React.useState("")
  const [url, setUrl] = React.useState("")

  const isFolder = editingBookmark ? editingBookmark.url === undefined : false

  React.useEffect(() => {
    if (editingBookmark) {
      setTitle(editingBookmark.title)
      setUrl(editingBookmark.url ?? "")
    }
  }, [editingBookmark])

  const handleSave = async () => {
    if (!editingBookmark) return

    const changes: { title?: string; url?: string } = {}
    if (title !== editingBookmark.title) changes.title = title
    if (!isFolder && url !== editingBookmark.url) changes.url = url

    if (Object.keys(changes).length > 0) {
      await updateBookmark(editingBookmark.id, changes)
    }
    closeEditor()
  }

  return (
    <Dialog
      open={editingBookmark !== null}
      onOpenChange={(o) => { if (!o) closeEditor() }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isFolder ? "Edit Folder" : "Edit Bookmark"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bookmark-title">Title</Label>
            <Input
              id="bookmark-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bookmark title"
            />
          </div>

          {!isFolder && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="bookmark-url">URL</Label>
              <Input
                id="bookmark-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeEditor}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
