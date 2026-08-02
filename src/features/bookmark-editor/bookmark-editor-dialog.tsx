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
  const mutationError = useBookmarkStore((s) => s.mutationError)
  const clearMutationError = useBookmarkStore((s) => s.clearMutationError)

  const [title, setTitle] = React.useState("")
  const [url, setUrl] = React.useState("")

  const isFolder = editingBookmark ? editingBookmark.url === undefined : false

  React.useEffect(() => {
    if (editingBookmark) {
      setTitle(editingBookmark.title)
      setUrl(editingBookmark.url ?? "")
      clearMutationError()
    }
  }, [editingBookmark, clearMutationError])

  const handleSave = async () => {
    if (!editingBookmark) return

    const changes: { title?: string; url?: string } = {}
    if (title !== editingBookmark.title) changes.title = title
    if (!isFolder && url !== editingBookmark.url) changes.url = url

    if (Object.keys(changes).length > 0) {
      await updateBookmark(editingBookmark.id, changes)
      if (useBookmarkStore.getState().mutationError) return
    }
    closeEditor()
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleSave()
  }

  return (
    <Dialog
      open={editingBookmark !== null}
      onOpenChange={(o) => {
        if (!o) closeEditor()
      }}
    >
      <DialogContent>
        {/* A real form with a submit button, so Enter saves. Browsers only
            submit implicitly when a form has one field, which left the
            two-field bookmark case ignoring the key entirely. */}
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
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

            {mutationError && (
              <p role="alert" className="text-sm text-destructive">
                {mutationError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEditor}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
