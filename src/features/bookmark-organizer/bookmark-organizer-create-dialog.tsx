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
  const mutationError = useBookmarkStore((s) => s.mutationError)
  const clearMutationError = useBookmarkStore((s) => s.clearMutationError)

  const [title, setTitle] = React.useState("")
  const [url, setUrl] = React.useState("")
  // Empty fields only complain once the user has actually been there and left
  // them blank — a dialog that opens already shouting is worse than one that
  // waits to be asked.
  const [touched, setTouched] = React.useState({ title: false, url: false })

  React.useEffect(() => {
    setTitle("")
    setUrl("")
    setTouched({ title: false, url: false })
    clearMutationError()
  }, [creatingItem, clearMutationError])

  if (!creatingItem) {
    return null
  }

  const isBookmark = creatingItem.type === "bookmark"
  const dialogTitle = isBookmark ? "New Bookmark" : "New Folder"

  const normalizedTitle = title.trim()
  const normalizedUrl = url.trim()
  const canCreate =
    normalizedTitle !== "" && (!isBookmark || normalizedUrl !== "")

  const handleCreate = async () => {
    if (!canCreate) return

    if (isBookmark) {
      await createBookmark(
        creatingItem.parentId,
        normalizedTitle,
        normalizedUrl
      )
    } else {
      await createFolder(creatingItem.parentId, normalizedTitle)
    }

    if (useBookmarkStore.getState().mutationError) return
    closeCreateItem()
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void handleCreate()
  }

  const titleError = touched.title && normalizedTitle === ""
  const urlError = isBookmark && touched.url && normalizedUrl === ""

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
        <form
          className="flex flex-col gap-4"
          noValidate
          onSubmit={handleSubmit}
        >
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
                aria-invalid={titleError || undefined}
                aria-describedby={
                  titleError
                    ? "bookmark-organizer-create-title-error"
                    : undefined
                }
                onChange={(event) => setTitle(event.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, title: true }))}
              />
              {titleError && (
                <p
                  id="bookmark-organizer-create-title-error"
                  className="text-xs text-destructive"
                >
                  A title is required.
                </p>
              )}
            </div>

            {isBookmark && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="bookmark-organizer-create-url">URL</Label>
                <Input
                  id="bookmark-organizer-create-url"
                  type="text"
                  value={url}
                  aria-invalid={urlError || undefined}
                  aria-describedby={
                    urlError ? "bookmark-organizer-create-url-error" : undefined
                  }
                  onChange={(event) => setUrl(event.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, url: true }))}
                />
                {urlError && (
                  <p
                    id="bookmark-organizer-create-url-error"
                    className="text-xs text-destructive"
                  >
                    A URL is required.
                  </p>
                )}
              </div>
            )}

            {mutationError && (
              <p role="alert" className="text-sm text-destructive">
                {mutationError}
              </p>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeCreateItem}>
              Cancel
            </Button>
            {/* `type="submit"` is what makes Enter work in the two-field
                bookmark form; browsers only submit implicitly when a form has
                a single field, so folders used to accept Enter and bookmarks
                silently did not. */}
            <Button
              type="submit"
              disabled={!canCreate}
              title={
                canCreate
                  ? undefined
                  : isBookmark
                    ? "Enter a title and a URL first."
                    : "Enter a title first."
              }
            >
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
