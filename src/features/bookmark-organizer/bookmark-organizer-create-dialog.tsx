import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"

export function BookmarkOrganizerCreateDialog() {
  const creatingItem = useUIStore((s) => s.creatingItem)
  const closeCreateItem = useUIStore((s) => s.closeCreateItem)
  const createFolder = useBookmarkStore((s) => s.createFolder)
  const createBookmark = useBookmarkStore((s) => s.createBookmark)

  const [title, setTitle] = React.useState("")
  const [url, setUrl] = React.useState("")

  React.useEffect(() => {
    setTitle("")
    setUrl("")
  }, [creatingItem])

  if (!creatingItem) {
    return null
  }

  const isBookmark = creatingItem.type === "bookmark"
  const dialogTitle = isBookmark ? "New Bookmark" : "New Folder"

  const handleCreate = async () => {
    if (!creatingItem) {
      return
    }

    const titleInput = document.getElementById(
      "bookmark-organizer-create-title"
    ) as HTMLInputElement | null
    const urlInput = document.getElementById(
      "bookmark-organizer-create-url"
    ) as HTMLInputElement | null

    const normalizedTitle = titleInput?.value.trim() ?? ""
    const normalizedUrl = urlInput?.value.trim() ?? ""

    if (!normalizedTitle) {
      return
    }

    if (isBookmark) {
      if (!normalizedUrl) {
        return
      }
      await createBookmark(
        creatingItem.parentId,
        normalizedTitle,
        normalizedUrl
      )
    } else {
      await createFolder(creatingItem.parentId, normalizedTitle)
    }

    closeCreateItem()
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleCreate()
  }

  return (
    <Dialog
      open={creatingItem !== null}
      onOpenChange={(open) => {
        if (!open) {
          closeCreateItem()
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-4" noValidate onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="bookmark-organizer-create-title">Title</Label>
              <Input
                id="bookmark-organizer-create-title"
                autoFocus
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            {isBookmark && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="bookmark-organizer-create-url">URL</Label>
                <Input
                  id="bookmark-organizer-create-url"
                  type="text"
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeCreateItem}
            >
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleCreate()}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
