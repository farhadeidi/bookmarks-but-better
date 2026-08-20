import * as React from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { BookmarkAdd01Icon } from "@hugeicons/core-free-icons"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { platformCapabilities } from "@/sources/platform"
import {
  CaptureController,
  createCaptureDependencies,
  type CaptureControllerDependencies,
  type CaptureSnapshot,
} from "./capture-controller"

export interface CapturePopupProps {
  dependencies?: CaptureControllerDependencies
}

export function CapturePopup({ dependencies }: CapturePopupProps) {
  const [snapshot, setSnapshot] = React.useState<CaptureSnapshot>(() => ({
    phase: "loading",
    title: "",
    url: "",
    folders: [],
    folderId: "",
    sourceId: "",
    sourceLabel: "",
    choices: [],
    message: null,
  }))
  const controllerRef = React.useRef<CaptureController | null>(null)

  React.useEffect(() => {
    const controller = new CaptureController(
      dependencies ?? createCaptureDependencies()
    )
    controllerRef.current = controller
    const unsubscribe = controller.subscribe(setSnapshot)
    void controller.initialize()

    return () => {
      unsubscribe()
      controller.dispose()
      if (controllerRef.current === controller) controllerRef.current = null
    }
  }, [dependencies])

  const isBusy = snapshot.phase === "loading" || snapshot.phase === "submitting"
  const canSubmit =
    snapshot.phase === "ready" && snapshot.title.trim().length > 0

  // Safari cannot override the new-tab page, so its only route to the
  // dashboard is a tab opened from here. Capability-seam driven, not a
  // browser-name branch.
  const canOpenDashboard = React.useMemo(() => {
    const caps = platformCapabilities()
    return caps.isExtension && !caps.browserSource
  }, [])
  const openDashboard = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL("index.html") })
  }

  return (
    <main className="isolate flex min-h-64 w-96 max-w-full flex-col gap-5 bg-background p-5 text-foreground antialiased">
      <header className="flex min-w-0 items-start gap-3">
        <HugeiconsIcon
          icon={BookmarkAdd01Icon}
          className="size-4 shrink-0 stroke-foreground"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h1 className="font-semibold text-balance">Save this page</h1>
          {/* The destination: the profile's Active Source, labelled on every
              capture so what "Save" writes is never a guess. With more than
              one enabled source the label becomes a quick change. */}
          {snapshot.choices.length > 1 ? (
            <Select
              value={snapshot.sourceId}
              onValueChange={(sourceId) => {
                if (sourceId) void controllerRef.current?.switchSource(sourceId)
              }}
              disabled={isBusy}
            >
              <SelectTrigger
                className="h-7 w-full border-none bg-accent/40 px-2 text-sm text-muted-foreground shadow-none sm:text-xs"
                aria-label="Destination source"
              >
                <span className="truncate">
                  {snapshot.sourceLabel || "Choosing destination…"}
                </span>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false}>
                <SelectGroup>
                  {snapshot.choices.map((choice) => (
                    <SelectItem key={choice.id} value={choice.id}>
                      {choice.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          ) : (
            <p className="truncate text-base text-pretty text-muted-foreground sm:text-sm">
              {snapshot.sourceLabel || "Preparing bookmark source…"}
            </p>
          )}
        </div>
      </header>

      {snapshot.phase === "loading" ? (
        <div
          className="flex flex-1 items-center justify-center gap-2 text-base text-muted-foreground sm:text-sm"
          role="status"
          aria-live="polite"
        >
          <Spinner aria-hidden="true" />
          Loading page details…
        </div>
      ) : snapshot.phase === "error" ? (
        <Alert variant="destructive">
          <AlertTitle>Cannot save this page</AlertTitle>
          <AlertDescription>{snapshot.message}</AlertDescription>
        </Alert>
      ) : (
        <form
          className="flex flex-1 flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            void controllerRef.current?.submit()
          }}
        >
          <FieldGroup className="gap-4">
            <Field
              data-invalid={!snapshot.title.trim()}
              data-disabled={isBusy || snapshot.phase === "success"}
            >
              <FieldLabel htmlFor="capture-title">Title</FieldLabel>
              <Input
                id="capture-title"
                value={snapshot.title}
                onChange={(event) =>
                  controllerRef.current?.setTitle(event.target.value)
                }
                disabled={isBusy || snapshot.phase === "success"}
                autoFocus
                autoComplete="off"
                aria-invalid={!snapshot.title.trim()}
              />
              {!snapshot.title.trim() ? (
                <FieldError>A title is required.</FieldError>
              ) : null}
            </Field>

            <Field>
              <FieldLabel htmlFor="capture-url">Page</FieldLabel>
              <Input id="capture-url" value={snapshot.url} readOnly />
            </Field>

            <Field data-disabled={isBusy || snapshot.phase === "success"}>
              <FieldLabel htmlFor="capture-folder">Folder</FieldLabel>
              <Select
                value={snapshot.folderId}
                onValueChange={(folderId) => {
                  if (folderId) controllerRef.current?.setFolderId(folderId)
                }}
                disabled={isBusy || snapshot.phase === "success"}
              >
                <SelectTrigger id="capture-folder" className="w-full">
                  <span className="truncate">
                    {snapshot.folders.find(
                      (folder) => folder.id === snapshot.folderId
                    )?.label ?? "Choose a folder"}
                  </span>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  <SelectGroup>
                    {snapshot.folders.map((folder) => (
                      <SelectItem key={folder.id} value={folder.id}>
                        {folder.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                This choice applies only to this bookmark.
              </FieldDescription>
            </Field>
          </FieldGroup>

          {snapshot.message ? (
            <Alert
              variant={snapshot.phase === "success" ? "default" : "destructive"}
              aria-live="polite"
            >
              <AlertTitle>
                {snapshot.phase === "success"
                  ? "Bookmark saved"
                  : "Save failed"}
              </AlertTitle>
              <AlertDescription>{snapshot.message}</AlertDescription>
            </Alert>
          ) : null}

          <Button
            type="submit"
            size="sm"
            disabled={!canSubmit}
            className="w-full"
          >
            {snapshot.phase === "submitting" ? (
              <Spinner data-icon="inline-start" aria-hidden="true" />
            ) : (
              <HugeiconsIcon
                icon={BookmarkAdd01Icon}
                data-icon="inline-start"
                aria-hidden="true"
              />
            )}
            {snapshot.phase === "submitting"
              ? "Saving…"
              : snapshot.phase === "success"
                ? "Saved"
                : "Save bookmark"}
          </Button>
        </form>
      )}

      {/* Outside the branch above on purpose. Where the popup is the only
          route to the dashboard, the error state is exactly when this is
          needed most: "no bookmark source is enabled" tells the user to go and
          connect one, and rendering this only alongside the form left them
          with nowhere to go. */}
      {canOpenDashboard && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full"
          onClick={openDashboard}
        >
          Open the dashboard
        </Button>
      )}
    </main>
  )
}
