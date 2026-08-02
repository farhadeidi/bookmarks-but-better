import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { ConflictResolution, ImportConflict } from "./import-plan"

interface ImportConflictDialogProps {
  conflicts: ImportConflict[]
  onResolve: (resolutions: Record<string, ConflictResolution>) => void
  onCancel: () => void
}

const ACTIONS: { value: ConflictResolution; label: string; hint: string }[] = [
  {
    value: "skip",
    label: "Skip",
    hint: "Leave the bookmark that is already there and drop the incoming one.",
  },
  {
    value: "replace",
    label: "Replace",
    hint: "Keep one bookmark, using the incoming title.",
  },
  {
    value: "keep-both",
    label: "Keep both",
    hint: "Import the incoming bookmark alongside the existing one.",
  },
]

/**
 * Asks what to do about bookmarks that already exist at their destination,
 * one at a time, in the shape a file manager uses.
 *
 * Answers are collected and returned in one go rather than applied as they are
 * given: nothing has been written when this is on screen, so cancelling has to
 * leave the tree exactly as it was.
 */
export function ImportConflictDialog({
  conflicts,
  onResolve,
  onCancel,
}: ImportConflictDialogProps) {
  const [index, setIndex] = React.useState(0)
  const [resolutions, setResolutions] = React.useState<
    Record<string, ConflictResolution>
  >({})
  const [applyToAll, setApplyToAll] = React.useState(false)

  const conflict = conflicts[index]
  if (!conflict) return null

  const choose = (resolution: ConflictResolution) => {
    const next = { ...resolutions }

    if (applyToAll) {
      for (const remaining of conflicts.slice(index)) {
        next[remaining.key] = resolution
      }
      onResolve(next)
      return
    }

    next[conflict.key] = resolution
    setResolutions(next)

    if (index + 1 >= conflicts.length) {
      onResolve(next)
      return
    }
    setIndex(index + 1)
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>This bookmark already exists</DialogTitle>
          <DialogDescription>
            {conflicts.length === 1
              ? "One incoming bookmark points at a URL that is already saved."
              : `Conflict ${index + 1} of ${conflicts.length}. Some incoming bookmarks point at URLs that are already saved.`}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1 rounded-lg border border-border/70 p-3">
            <p className="truncate text-sm font-medium">
              {conflict.incomingTitle}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {conflict.url}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Already saved as{" "}
              <span className="font-medium text-foreground">
                {conflict.existingTitle}
              </span>
              {conflict.path ? ` in ${conflict.path}` : " in the destination"}.
            </p>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={applyToAll}
              onChange={(e) => setApplyToAll(e.target.checked)}
              className="size-3.5 accent-primary"
            />
            Apply my choice to the remaining{" "}
            {conflicts.length - index - 1 === 0
              ? "conflicts"
              : `${conflicts.length - index - 1} conflicts`}
          </label>

          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((action) => (
              <Button
                key={action.value}
                variant={action.value === "skip" ? "default" : "outline"}
                size="sm"
                title={action.hint}
                onClick={() => choose(action.value)}
              >
                {action.label}
              </Button>
            ))}
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Cancel import
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
