import * as React from "react"
import {
  RootFolderSelect,
  resolveEffectiveCreateParentId,
} from "@/features/root-folder-select"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useBookmarkStore } from "@/stores/bookmark-store"

interface RootFolderStepProps {
  value: string | null
  onChange: (id: string | null) => void
}

export function RootFolderStep({ value, onChange }: RootFolderStepProps) {
  const tree = useBookmarkStore((s) => s.tree)
  const adapter = useBookmarkStore((s) => s.adapter)
  const createFolder = useBookmarkStore((s) => s.createFolder)
  const refresh = useBookmarkStore((s) => s.refresh)
  const mutationError = useBookmarkStore((s) => s.mutationError)

  const [newFolderName, setNewFolderName] = React.useState("")
  const [isCreating, setIsCreating] = React.useState(false)

  const defaultParentId = React.useMemo(
    () =>
      resolveEffectiveCreateParentId(
        tree,
        adapter?.capabilities.rootIsCreatable ?? false
      ),
    [tree, adapter]
  )

  const handleCreate = async () => {
    const title = newFolderName.trim()
    if (!title || !defaultParentId) return

    setIsCreating(true)
    const created = await createFolder(defaultParentId, title)
    await refresh()
    setIsCreating(false)

    if (!created) return

    setNewFolderName("")
    onChange(created.id)
  }

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          Choose your bookmark folder
        </h2>
        <p className="text-muted-foreground">
          The dashboard only shows the folders inside this one, so picking a
          dedicated folder gives you a curated page instead of every bookmark
          you own. You can change this later in settings.
        </p>
      </div>

      <RootFolderSelect value={value} onChange={onChange} />

      {defaultParentId && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border/70 p-3">
          <p className="text-xs text-muted-foreground">
            New here? We recommend creating a dedicated folder — like{" "}
            <span className="font-medium text-foreground">
              Personal Bookmarks
            </span>{" "}
            or <span className="font-medium text-foreground">Work</span> — for
            the bookmarks you want to always see on this page.
          </p>
          <div className="flex gap-2">
            <Input
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Personal Bookmarks"
              aria-label="New folder name"
              disabled={isCreating}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isCreating || newFolderName.trim() === ""}
              onClick={() => void handleCreate()}
            >
              {isCreating ? "Creating…" : "Create folder"}
            </Button>
          </div>
          {mutationError && (
            <p role="alert" className="text-xs text-destructive">
              {mutationError}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
