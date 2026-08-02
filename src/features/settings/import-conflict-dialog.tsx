import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { ConflictResolution, ImportConflict } from "./import-plan"

interface ImportConflictDialogProps {
  conflicts: ImportConflict[]
  onResolve: (resolutions: Record<string, ConflictResolution>) => void
  onCancel: () => void
}

const ACTION_LABELS: Record<ConflictResolution, string> = {
  skip: "Skip",
  replace: "Replace",
  "keep-both": "Keep both",
}

const BULK_LABELS: Record<ConflictResolution, string> = {
  skip: "Skip all",
  replace: "Replace all",
  "keep-both": "Keep both for all",
}

const ACTION_HINTS: Record<ConflictResolution, string> = {
  skip: "Leave the bookmark that is already there and drop the incoming one.",
  replace: "Keep one bookmark, using the incoming title.",
  "keep-both": "Import the incoming bookmark alongside the existing one.",
}

const ACTIONS: ConflictResolution[] = ["skip", "replace", "keep-both"]

function everything(
  conflicts: ImportConflict[],
  resolution: ConflictResolution
): Record<string, ConflictResolution> {
  return Object.fromEntries(conflicts.map((c) => [c.key, resolution]))
}

/**
 * Asks what to do about bookmarks that already exist at their destination.
 *
 * Opens on a summary, because one decision usually covers a whole file and
 * making someone answer the same question 200 times is not a choice, it is a
 * chore. Review-one-by-one is there for when the answer genuinely differs, and
 * that view keeps the same actions plus an "apply to the rest" escape hatch.
 *
 * Answers are collected and returned in one go rather than applied as they are
 * given: nothing has been written while this is on screen, so cancelling has to
 * leave the tree exactly as it was.
 */
export function ImportConflictDialog({
  conflicts,
  onResolve,
  onCancel,
}: ImportConflictDialogProps) {
  const [reviewing, setReviewing] = React.useState(false)
  const [index, setIndex] = React.useState(0)
  const [resolutions, setResolutions] = React.useState<
    Record<string, ConflictResolution>
  >({})
  const [applyToRest, setApplyToRest] = React.useState(false)

  const conflict = conflicts[index]
  const remaining = conflicts.length - index - 1

  const choose = (resolution: ConflictResolution) => {
    if (!conflict) return

    const next = { ...resolutions, [conflict.key]: resolution }

    if (applyToRest) {
      onResolve({ ...next, ...everything(conflicts.slice(index), resolution) })
      return
    }

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
        {!reviewing || !conflict ? (
          <>
            <DialogHeader>
              <DialogTitle>
                {conflicts.length === 1
                  ? "1 bookmark already exists"
                  : `${conflicts.length} bookmarks already exist`}
              </DialogTitle>
              <DialogDescription>
                These point at URLs that are already saved where they would
                land. Choose once for all of them, or go through them one at a
                time.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-48 rounded-lg border border-border/70">
              <ul className="divide-y divide-border/50">
                {conflicts.map((item) => (
                  <li key={item.key} className="px-3 py-2">
                    <p className="truncate text-sm">{item.incomingTitle}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {item.path ? `${item.path} · ` : ""}
                      {item.url}
                    </p>
                  </li>
                ))}
              </ul>
            </ScrollArea>

            <div className="flex flex-wrap gap-2">
              {ACTIONS.map((action) => (
                <Button
                  key={action}
                  variant={action === "skip" ? "default" : "outline"}
                  size="sm"
                  title={ACTION_HINTS[action]}
                  onClick={() => onResolve(everything(conflicts, action))}
                >
                  {BULK_LABELS[action]}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReviewing(true)}
              >
                Review one by one
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Cancel import
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>This bookmark already exists</DialogTitle>
              <DialogDescription>
                {conflicts.length === 1
                  ? "One incoming bookmark points at a URL that is already saved."
                  : `Conflict ${index + 1} of ${conflicts.length}.`}
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
                  {conflict.path
                    ? ` in ${conflict.path}`
                    : " in the destination"}
                  .
                </p>
              </div>

              {remaining > 0 && (
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={applyToRest}
                    onChange={(e) => setApplyToRest(e.target.checked)}
                    className="size-3.5 accent-primary"
                  />
                  Apply my choice to the remaining {remaining} conflict
                  {remaining === 1 ? "" : "s"}
                </label>
              )}

              <div className="flex flex-wrap gap-2">
                {ACTIONS.map((action) => (
                  <Button
                    key={action}
                    variant={action === "skip" ? "default" : "outline"}
                    size="sm"
                    title={ACTION_HINTS[action]}
                    onClick={() => choose(action)}
                  >
                    {ACTION_LABELS[action]}
                  </Button>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    index === 0 ? setReviewing(false) : setIndex(index - 1)
                  }
                >
                  Back
                </Button>
                <Button variant="ghost" size="sm" onClick={onCancel}>
                  Cancel import
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
