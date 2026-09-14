import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useSourceStore } from "@/stores/source-store"
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkGrid } from "@/features/bookmark-grid"
import { GridErrorBoundary, SafeModeNotice } from "@/features/safety-net"
import { DndMonitor } from "@/features/dnd"
import { FilterBar } from "@/features/filter-bar"
import { StandaloneDeprecationBanner } from "@/features/standalone-sunset"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Settings03Icon,
  FolderTreeIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
// Imported past the feature's barrel on purpose: the listener has to be
// mounted before the palette exists, and the barrel would defeat the lazy
// chunk below.
import { useSearchTypeAhead } from "@/features/search-palette/use-search-type-ahead"

const SettingsDialog = React.lazy(() =>
  import("@/features/settings").then((m) => ({ default: m.SettingsDialog }))
)
// The guard's constants fold in every production bundle and in the marketing
// preview, so this is `null` there. The dynamic import, dev chunk and preload
// entry are eliminated by dead-branch removal.
const ScenarioWorkbench =
  !__MARKETING_PREVIEW__ &&
  import.meta.env.DEV &&
  import.meta.env.MODE !== "test"
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
const SearchPaletteDialog = React.lazy(() =>
  import("@/features/search-palette").then((m) => ({
    default: m.SearchPaletteDialog,
  }))
)

export function App() {
  const { onboardingChecked } = useAppBootstrap()
  useSearchTypeAhead()
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
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const activeSourceId = useSourceStore((s) => s.activeSourceId)
  const safeMode = usePreferencesStore((s) => s.safeMode)
  const containerMode = usePreferencesStore((s) => s.containerMode)
  const openBookmarkOrganizer = useUIStore((s) => s.openBookmarkOrganizer)
  const openSearchPalette = useUIStore((s) => s.openSearchPalette)

  return (
    <ScrollArea className="h-svh bg-background text-foreground">
      <div className="flex flex-col gap-5 px-4 pt-8 pb-8">
        {/* The header row: the filter bar's breadcrumb on the left, the three
            global actions on the right. It mirrors the grid's width so both
            ends line up with the card columns, and it always renders — the
            actions stay reachable even when the filter bar has nothing to
            show. Not sticky: search also opens by typing anywhere. */}
        <header
          className={cn(
            "flex w-full min-w-0 items-center gap-2",
            containerMode === "contained" && "mx-auto max-w-[1440px]"
          )}
        >
          <div className="min-w-0 flex-1">
            {sourceStatus === "ready" && <FilterBar />}
          </div>

          {/* Appearance and product information live in their Settings
              categories instead of being duplicated here. */}
          <div
            role="toolbar"
            aria-label="App actions"
            className="flex shrink-0 items-center gap-0.5 max-sm:[&_button]:size-12"
          >
            {/* Typing anywhere on the page opens the same palette; this is
                the way in for a pointer, and the only one on a touch screen. */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={() => openSearchPalette()}
                    aria-label="Search bookmarks"
                  />
                }
              >
                <HugeiconsIcon icon={Search01Icon} />
              </TooltipTrigger>
              <TooltipContent side="bottom">Search bookmarks</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={openBookmarkOrganizer}
                    aria-label="Bookmark tree"
                  />
                }
              >
                <HugeiconsIcon icon={FolderTreeIcon} />
              </TooltipTrigger>
              <TooltipContent side="bottom">Bookmark tree</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-muted-foreground hover:text-foreground"
                    onClick={openSettings}
                    aria-label="Settings"
                  />
                }
              >
                <HugeiconsIcon icon={Settings03Icon} />
              </TooltipTrigger>
              <TooltipContent side="bottom">Settings</TooltipContent>
            </Tooltip>
          </div>
        </header>

        <main className="flex flex-col gap-5">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void retry()}
                >
                  Retry
                </Button>
                <Button variant="outline" size="sm" onClick={openSettings}>
                  Switch source
                </Button>
              </div>
            </div>
          ) : safeMode ? (
            <SafeModeNotice />
          ) : isLoading || status === "loading" ? (
            <div className="flex items-center justify-center p-12 text-muted-foreground">
              Loading bookmarks...
            </div>
          ) : (
            // Keyed on what the grid draws from, so fixing the cause in
            // Settings — another root folder, another source — gives the grid a
            // fresh boundary and a fresh attempt without a reload.
            <GridErrorBoundary key={`${activeSourceId}:${rootFolderId}`}>
              <BookmarkGrid />
            </GridErrorBoundary>
          )}
        </main>
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
        <SearchPaletteDialog />
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
