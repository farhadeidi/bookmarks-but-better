import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useSourceStore } from "@/stores/source-store"
import { useUIStore } from "@/stores/ui-store"
import { BookmarkGrid } from "@/features/bookmark-grid"
import { DndMonitor } from "@/features/dnd"
import { SourceSwitcher } from "@/features/source-switcher"
import { StandaloneDeprecationBanner } from "@/features/standalone-sunset"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import { Settings03Icon, FolderTreeIcon } from "@hugeicons/core-free-icons"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"

const SettingsDialog = React.lazy(() =>
  import("@/features/settings").then((m) => ({ default: m.SettingsDialog }))
)
// The guard's constants fold in every production bundle, so this is `null`
// there — and the dynamic import, the whole dev chunk and its preload entry
// are eliminated by dead-branch removal.
const ScenarioWorkbench =
  import.meta.env.DEV && import.meta.env.MODE !== "test"
    ? React.lazy(() =>
        import("@/dev/workbench").then((m) => ({
          default: m.ScenarioWorkbench,
        }))
      )
    : null
const BookmarkEditorDialog = React.lazy(() =>
  import("@/features/bookmark-editor").then((m) => ({
    default: m.BookmarkEditorDialog,
  }))
)
const DeleteConfirmDialog = React.lazy(() =>
  import("@/features/delete-confirm").then((m) => ({
    default: m.DeleteConfirmDialog,
  }))
)
const BookmarkOrganizerSheet = React.lazy(() =>
  import("@/features/bookmark-organizer").then((m) => ({
    default: m.BookmarkOrganizerSheet,
  }))
)
const OnboardingWizard = React.lazy(() =>
  import("@/features/onboarding").then((m) => ({
    default: m.OnboardingWizard,
  }))
)

export function App() {
  const { onboardingChecked } = useAppBootstrap()
  const onboardingOpen = useUIStore((s) => s.onboardingOpen)
  const closeOnboarding = useUIStore((s) => s.closeOnboarding)
  const openSettings = useUIStore((s) => s.openSettings)
  const sourceStatus = useSourceStore((s) => s.status)
  const hasActiveSource = useSourceStore((s) => s.activeSourceId !== null)
  const switching = useSourceStore((s) => s.switching)
  const isLoading = useBookmarkStore((s) => s.isLoading)
  const status = useBookmarkStore((s) => s.status)
  const loadError = useBookmarkStore((s) => s.loadError)
  const retry = useBookmarkStore((s) => s.retry)
  const openBookmarkOrganizer = useUIStore((s) => s.openBookmarkOrganizer)

  return (
    <ScrollArea className="h-svh bg-background text-foreground">
      {/* Main content */}
      <main className="flex flex-col gap-5 px-4 pt-8 pb-24">
        {/* The compact source control: tab switcher with several enabled
            sources, name/health badge with one. Sits above the bookmarks so
            the destination of every operation below it is visible. */}
        {sourceStatus === "ready" && <SourceSwitcher />}
        {sourceStatus === "ready" && <StandaloneDeprecationBanner />}

        {sourceStatus === "ready" && !hasActiveSource ? (
          <div
            className="flex flex-col items-center gap-3 p-12 text-center text-muted-foreground"
            role="status"
          >
            <p className="font-medium text-foreground">
              No bookmark source yet.
            </p>
            <p className="max-w-md text-sm">
              This build has no Browser Source — connect a local{" "}
              <code>bookmarks-but-better</code> daemon and each Vault it hosts
              becomes a source.
            </p>
            <Button variant="outline" size="sm" onClick={openSettings}>
              Connect a daemon
            </Button>
          </div>
        ) : switching ? (
          <div className="flex items-center justify-center gap-2 p-12 text-muted-foreground">
            Switching source…
          </div>
        ) : status === "unavailable" ? (
          <div
            role="alert"
            className="flex flex-col items-center gap-3 p-12 text-center text-muted-foreground"
          >
            <p className="font-medium text-foreground">
              Bookmarks are unavailable.
            </p>
            <p className="text-sm">
              {loadError ?? "Could not reach the bookmark source."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void retry()}>
                Retry
              </Button>
              <Button variant="outline" size="sm" onClick={openSettings}>
                Switch source
              </Button>
            </div>
          </div>
        ) : isLoading || status === "loading" ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            Loading bookmarks...
          </div>
        ) : (
          <BookmarkGrid />
        )}
      </main>

      {/* The two global actions. Appearance and product information live in
          their corresponding Settings categories instead of being duplicated
          here. */}
      <div
        role="toolbar"
        aria-label="App actions"
        className="fixed right-4 bottom-4 z-10 flex w-fit items-center gap-2 rounded-2xl border border-border/60 bg-background/90 px-2 py-1.5 shadow-sm backdrop-blur-sm sm:right-6 sm:bottom-6 max-sm:[&_button]:size-12"
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                onClick={openBookmarkOrganizer}
                aria-label="Bookmark tree"
              />
            }
          >
            <HugeiconsIcon icon={FolderTreeIcon} />
          </TooltipTrigger>
          <TooltipContent side="top">Bookmark tree</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                onClick={openSettings}
                aria-label="Settings"
              />
            }
          >
            <HugeiconsIcon icon={Settings03Icon} />
          </TooltipTrigger>
          <TooltipContent side="top">Settings</TooltipContent>
        </Tooltip>
      </div>

      {/* DnD monitor (renders nothing, handles drop logic) */}
      <DndMonitor />

      {/* Dev Workbench: the dev-server-only scenario panel, absent from
          every production bundle. */}
      {ScenarioWorkbench && (
        <React.Suspense fallback={null}>
          <ScenarioWorkbench />
        </React.Suspense>
      )}

      {/* Dialogs */}
      <React.Suspense fallback={null}>
        <SettingsDialog />
        <BookmarkEditorDialog />
        <DeleteConfirmDialog />
        <BookmarkOrganizerSheet />
        {onboardingOpen && onboardingChecked && (
          <OnboardingWizard onComplete={closeOnboarding} />
        )}
      </React.Suspense>
    </ScrollArea>
  )
}

export default App
