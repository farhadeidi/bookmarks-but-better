import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { useSourceStore, enabledSourceDescriptors } from "@/stores/source-store"
import { createAdapterForSource } from "@/sources/adapters"
import { resolveDefaultImportParentId } from "@/features/settings/import-target"
import { buildRootFolderOptions } from "@/features/root-folder-select"
import { ImportConflictDialog } from "@/features/settings/import-conflict-dialog"
import { formatImportResult } from "@/features/settings/import-bookmarks"
import type { ConflictResolution } from "@/features/settings/import-plan"
import {
  planStandaloneMigration,
  readStandaloneTree,
  runStandaloneMigration,
  type MigrationOutcome,
  type MigrationPreview,
} from "./standalone-migration"

type Step = "destination" | "preview" | "copying" | "done"

/**
 * The Standalone migration flow: choose a destination, preview the copy,
 * resolve conflicts, copy through the import pipeline, verify by re-reading
 * the destination, then switch to it.
 *
 * The Standalone data is never touched: the flow only ever reads it, and it
 * stays readable in Settings → Data & Migration for the whole sunset period.
 */
export function StandaloneMigrationDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const config = useSourceStore((s) => s.config)
  // Derived from the config reference (like the source switcher), so the
  // selector result stays referentially stable between config changes.
  const sources = React.useMemo(
    () =>
      enabledSourceDescriptors({ config }).filter(
        (source) => source.id !== "standalone"
      ),
    [config]
  )
  const switchSource = useSourceStore((s) => s.switchSource)

  const [step, setStep] = React.useState<Step>("destination")
  const [destinationId, setDestinationId] = React.useState<string | null>(
    sources[0]?.id ?? null
  )
  const [parentId, setParentId] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<MigrationPreview | null>(null)
  const [conflictPlan, setConflictPlan] =
    React.useState<MigrationPreview | null>(null)
  const [outcome, setOutcome] = React.useState<MigrationOutcome | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [folderOptions, setFolderOptions] = React.useState<
    { id: string; label: string }[]
  >([])

  React.useEffect(() => {
    if (!open) {
      setStep("destination")
      setPreview(null)
      setConflictPlan(null)
      setOutcome(null)
      setError(null)
    } else {
      setDestinationId((current) => current ?? sources[0]?.id ?? null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const buildDestination = React.useCallback(() => {
    if (!destinationId) return null
    const descriptor = sources.find((s) => s.id === destinationId)
    if (!descriptor) return null
    return createAdapterForSource(descriptor, config.connections)
  }, [destinationId, sources, config.connections])

  const startPreview = async () => {
    const destination = buildDestination()
    if (!destination) return
    setError(null)
    try {
      const [standaloneTree, destinationTree] = await Promise.all([
        readStandaloneTree(),
        destination.bookmarks.getTree(),
      ])
      const defaultParent = resolveDefaultImportParentId(
        destinationTree,
        null,
        destination.capabilities.rootIsCreatable ?? false
      )
      const target = parentId ?? defaultParent
      if (!target) {
        setError(
          "The destination has no folder to copy into yet. Create one there first."
        )
        return
      }
      setFolderOptions(buildRootFolderOptions(destinationTree))
      const planned = planStandaloneMigration(
        standaloneTree,
        destinationTree,
        target
      )
      // The plan is bound to this exact target, so the copy must run against
      // it too: persist the resolution (default or explicit) instead of
      // leaving `parentId` null on the default path, where "Copy now" would
      // have nothing to copy into.
      setParentId(target)
      setPreview(planned)
      setStep("preview")
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The copy could not be planned."
      )
    }
  }

  const runCopy = async (
    resolutions: Record<string, ConflictResolution> = {}
  ) => {
    const destination = buildDestination()
    if (!destination || !preview || !parentId) return
    setConflictPlan(null)
    setStep("copying")
    try {
      const result = await runStandaloneMigration(
        destination.bookmarks,
        preview,
        parentId,
        resolutions
      )
      setOutcome(result)
      setStep("done")
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The copy could not be completed."
      )
      setStep("preview")
    }
  }

  const confirmPreview = () => {
    if (!preview) return
    if (preview.conflicts > 0) {
      setConflictPlan(preview)
      return
    }
    void runCopy()
  }

  const finish = async () => {
    if (destinationId && outcome?.verified) {
      await switchSource(destinationId)
    }
    onOpenChange(false)
  }

  return (
    <>
      {conflictPlan && (
        <ImportConflictDialog
          conflicts={conflictPlan.plan.conflicts}
          onCancel={() => setConflictPlan(null)}
          onResolve={(resolutions) => void runCopy(resolutions)}
        />
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Migrate Standalone bookmarks</DialogTitle>
            <DialogDescription>
              Copy your Standalone bookmarks into another source. Your
              Standalone data is left exactly as it is — nothing is deleted.
            </DialogDescription>
          </DialogHeader>

          {step === "destination" && (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="migration-target"
                >
                  Copy to
                </label>
                <Select
                  value={destinationId ?? ""}
                  onValueChange={(id) => {
                    setDestinationId(id)
                    setParentId(null)
                  }}
                >
                  <SelectTrigger id="migration-target" className="w-full">
                    <span className="truncate">
                      {sources.find((s) => s.id === destinationId)?.label ??
                        "Choose a destination"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={source.id}>
                        {source.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Browser bookmarks or a connected Daemon Source. The copy is
                  additive: nothing already in the destination is removed.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <label
                  className="text-sm font-medium"
                  htmlFor="migration-folder"
                >
                  Destination folder
                </label>
                <Select value={parentId ?? ""} onValueChange={setParentId}>
                  <SelectTrigger id="migration-folder" className="w-full">
                    <span className="truncate">
                      {folderOptions.find((f) => f.id === parentId)?.label ??
                        "Choose when previewing"}
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {(folderOptions.length > 0
                      ? folderOptions
                      : [{ id: "", label: "Default folder" }]
                    )
                      .filter((f) => f.id)
                      .map((folder) => (
                        <SelectItem key={folder.id} value={folder.id}>
                          {folder.label}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Left on the default, the copy lands in the destination's
                  chosen import folder.
                </p>
              </div>

              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  disabled={!destinationId}
                  onClick={() => void startPreview()}
                >
                  Preview the copy
                </Button>
              </div>
            </div>
          )}

          {step === "preview" && preview && (
            <div className="flex flex-col gap-4">
              <div className="rounded-lg border border-border/60 p-3 text-sm">
                <p className="font-medium">Ready to copy</p>
                <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
                  <li>
                    {preview.bookmarks} bookmark
                    {preview.bookmarks === 1 ? "" : "s"} and {preview.folders}{" "}
                    folder
                    {preview.folders === 1 ? "" : "s"} will be copied to{" "}
                    {sources.find((s) => s.id === destinationId)?.label}.
                  </li>
                  <li>
                    {preview.conflicts} duplicate
                    {preview.conflicts === 1 ? "" : "s"} need
                    {preview.conflicts === 1 ? "s" : ""} a decision.
                  </li>
                  <li>
                    The destination already holds {preview.destinationBookmarks}{" "}
                    bookmark
                    {preview.destinationBookmarks === 1 ? "" : "s"}; they stay.
                  </li>
                </ul>
              </div>
              {error && (
                <p role="alert" className="text-xs text-destructive">
                  {error}
                </p>
              )}
              <div className="flex justify-between">
                <Button variant="ghost" onClick={() => setStep("destination")}>
                  Back
                </Button>
                <Button onClick={confirmPreview}>
                  {preview.conflicts > 0 ? "Resolve duplicates" : "Copy now"}
                </Button>
              </div>
            </div>
          )}

          {step === "copying" && (
            <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
              <Spinner aria-hidden />
              Copying bookmarks…
            </div>
          )}

          {step === "done" && outcome && (
            <div className="flex flex-col gap-4">
              {outcome.verified ? (
                <div
                  role="status"
                  className="rounded-lg border border-border/60 p-3 text-sm"
                >
                  <p className="font-medium">Copy verified</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatImportResult(outcome.result)} The destination now
                    holds {outcome.verifiedCount} bookmarks.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Your Standalone bookmarks are still in place and remain
                    available under Data &amp; Migration for the rest of the
                    sunset.
                  </p>
                </div>
              ) : (
                <Alert variant="destructive">
                  <AlertTitle>Copy could not be fully verified</AlertTitle>
                  <AlertDescription>
                    {formatImportResult(outcome.result)} Re-run the migration to
                    finish the remainder — the copy is additive, so repeating it
                    is safe.
                  </AlertDescription>
                </Alert>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Stay here
                </Button>
                <Button
                  disabled={!outcome.verified || !destinationId}
                  onClick={() => void finish()}
                >
                  Switch to the destination
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
