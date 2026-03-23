import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useUIStore } from "@/stores/ui-store"
import { useBookmarkStore } from "@/stores/bookmark-store"

export function DeleteConfirmDialog() {
  const deletingItem = useUIStore((s) => s.deletingItem)
  const closeDeleteConfirm = useUIStore((s) => s.closeDeleteConfirm)
  const deleteBookmark = useBookmarkStore((s) => s.deleteBookmark)
  const deleteFolder = useBookmarkStore((s) => s.deleteFolder)

  const handleConfirm = async () => {
    if (!deletingItem) return

    if (deletingItem.type === "folder") {
      await deleteFolder(deletingItem.id)
    } else {
      await deleteBookmark(deletingItem.id)
    }
    closeDeleteConfirm()
  }

  return (
    <Dialog
      open={deletingItem !== null}
      onOpenChange={(o) => { if (!o) closeDeleteConfirm() }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete {deletingItem?.type === "folder" ? "Folder" : "Bookmark"}
          </DialogTitle>
          <DialogDescription>
            {deletingItem?.type === "folder" ? (
              <>
                Are you sure you want to delete the folder{" "}
                <strong>{deletingItem.title}</strong> and all its contents?
                This action cannot be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete{" "}
                <strong>{deletingItem?.title}</strong>? This action cannot be
                undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={closeDeleteConfirm}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
