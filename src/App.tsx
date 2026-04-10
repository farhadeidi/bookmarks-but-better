import * as React from "react"
import { detectAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"
import { BookmarkGrid } from "@/features/bookmark-grid"
import { DndMonitor } from "@/features/dnd"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Settings03Icon,
  Sun02Icon,
  Moon02Icon,
  ComputerSettingsIcon,
  PaintBucketIcon,
  Recycle02Icon,
  Folder01Icon,
  InformationCircleIcon,
} from "@hugeicons/core-free-icons"
import { useTheme } from "@/components/theme-provider"
import { COLOR_THEMES, type ColorTheme } from "@/stores/preferences-store"
import { getScreenshotMode } from "@/hooks/use-screenshot-mode"

const SettingsDialog = React.lazy(() =>
  import("@/features/settings").then((m) => ({ default: m.SettingsDialog }))
)
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
  const initBookmarks = useBookmarkStore((s) => s.init)
  const initPreferences = usePreferencesStore((s) => s.init)
  const [showOnboarding, setShowOnboarding] = React.useState(false)
  const [onboardingChecked, setOnboardingChecked] = React.useState(false)
  const openSettings = useUIStore((s) => s.openSettings)
  const isLoading = useBookmarkStore((s) => s.isLoading)
  const openBookmarkOrganizer = useUIStore((s) => s.openBookmarkOrganizer)
  const colorTheme = usePreferencesStore((s) => s.colorTheme)
  const setColorTheme = usePreferencesStore((s) => s.setColorTheme)
  const { theme, setTheme } = useTheme()
  const screenshotMode = getScreenshotMode()

  const themeOrder = ["light", "dark", "system"] as const
  const themeIcon = {
    light: Sun02Icon,
    dark: Moon02Icon,
    system: ComputerSettingsIcon,
  }

  const cycleTheme = () => {
    const idx = themeOrder.indexOf(theme)
    setTheme(themeOrder[(idx + 1) % themeOrder.length])
  }

  React.useEffect(() => {
    async function bootstrap() {
      const adapter = await detectAdapter()
      await Promise.all([initBookmarks(adapter), initPreferences(adapter)])
      if (screenshotMode === 'onboarding') {
        setShowOnboarding(true)
      } else if (!screenshotMode) {
        const onboardingCompleted = await adapter.storage.get<boolean>(
          "onboardingCompleted"
        )
        if (!onboardingCompleted) {
          setShowOnboarding(true)
        }
      }
      // screenshotMode === 'default': showOnboarding stays false (suppressed)
      setOnboardingChecked(true)
    }
    bootstrap()
  }, [initBookmarks, initPreferences, screenshotMode])

  return (
    <ScrollArea className="h-svh bg-background text-foreground">
      {/* Main content */}
      <main className="px-4 pt-8 pb-24">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            Loading bookmarks...
          </div>
        ) : (
          <BookmarkGrid />
        )}
      </main>

      {/* FAB buttons */}
      <div className="fixed right-6 bottom-6 z-10 flex items-center gap-2 rounded-2xl border border-border/60 bg-background/90 px-2 py-1.5 shadow-sm backdrop-blur-sm">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                onClick={openBookmarkOrganizer}
                aria-label="Bookmark Organizer"
              />
            }
          >
            <HugeiconsIcon icon={Folder01Icon} size={18} />
          </TooltipTrigger>
          <TooltipContent side="top">Bookmark Organizer</TooltipContent>
        </Tooltip>
        {/* Dropdown theme picker */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger
              render={
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="Pick color theme"
                    >
                      <HugeiconsIcon icon={PaintBucketIcon} size={18} />
                    </Button>
                  }
                />
              }
            />
            <TooltipContent side="top">Color theme</TooltipContent>
          </Tooltip>
          <DropdownMenuContent side="top" align="end">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Color Theme</DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={colorTheme}
              onValueChange={(value) => setColorTheme(value as ColorTheme)}
            >
              {COLOR_THEMES.map((t) => (
                <DropdownMenuRadioItem key={t} value={t} className="capitalize">
                  {t}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="icon"
                onClick={cycleTheme}
                aria-label="Toggle theme"
              />
            }
          >
            <HugeiconsIcon icon={themeIcon[theme]} size={18} />
          </TooltipTrigger>
          <TooltipContent side="top" className="capitalize">
            {theme}
          </TooltipContent>
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
            <HugeiconsIcon icon={Settings03Icon} size={18} />
          </TooltipTrigger>
          <TooltipContent side="top">Settings</TooltipContent>
        </Tooltip>
        <HoverCard>
          <Tooltip>
            <TooltipTrigger
              render={
                <HoverCardTrigger
                  render={
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="App info"
                    />
                  }
                >
                  <HugeiconsIcon icon={InformationCircleIcon} size={18} />
                </HoverCardTrigger>
              }
            />
            <TooltipContent side="top">App info</TooltipContent>
          </Tooltip>
          <HoverCardContent side="top" align="end">
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">
                  Bookmarks — But Better
                </span>
                <span className="text-xs text-muted-foreground">
                  Version {__APP_VERSION__}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                <a
                  href="https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=extension-info"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  Chrome Web Store
                </a>
                <a
                  href="https://github.com/farhadeidi/bookmarks-but-better"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                >
                  GitHub
                </a>
              </div>
            </div>
          </HoverCardContent>
        </HoverCard>
        {import.meta.env.DEV && !screenshotMode && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => {
                    indexedDB.deleteDatabase("bookmarks-but-better")
                    indexedDB.deleteDatabase("bookmarks-but-better-prefs")
                    chrome?.storage?.sync?.clear?.()
                    window.location.reload()
                  }}
                  aria-label="Reset data (dev)"
                />
              }
            >
              <HugeiconsIcon icon={Recycle02Icon} size={18} />
            </TooltipTrigger>
            <TooltipContent side="top">Reset data (dev)</TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* DnD monitor (renders nothing, handles drop logic) */}
      <DndMonitor />

      {/* Dialogs */}
      <React.Suspense fallback={null}>
        <SettingsDialog />
        <BookmarkEditorDialog />
        <DeleteConfirmDialog />
        <BookmarkOrganizerSheet />
        {showOnboarding && onboardingChecked && (
          <OnboardingWizard onComplete={() => setShowOnboarding(false)} />
        )}
      </React.Suspense>
    </ScrollArea>
  )
}

export default App
