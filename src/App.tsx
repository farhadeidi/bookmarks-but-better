import * as React from "react"
import { detectAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"
import { BookmarkGrid } from "@/features/bookmark-grid"
import { SettingsDialog } from "@/features/settings"
import { BookmarkEditorDialog } from "@/features/bookmark-editor"
import { DeleteConfirmDialog } from "@/features/delete-confirm"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  Settings03Icon,
  Sun02Icon,
  Moon02Icon,
  ComputerSettingsIcon,
} from "@hugeicons/core-free-icons"
import { useTheme } from "@/components/theme-provider"

export function App() {
  const initBookmarks = useBookmarkStore((s) => s.init)
  const initPreferences = usePreferencesStore((s) => s.init)
  const openSettings = useUIStore((s) => s.openSettings)
  const isLoading = useBookmarkStore((s) => s.isLoading)
  const { theme, setTheme } = useTheme()

  const themeOrder = ["light", "dark", "system"] as const
  const themeIcon = { light: Sun02Icon, dark: Moon02Icon, system: ComputerSettingsIcon }

  const cycleTheme = () => {
    const idx = themeOrder.indexOf(theme)
    setTheme(themeOrder[(idx + 1) % themeOrder.length])
  }

  React.useEffect(() => {
    async function bootstrap() {
      const adapter = await detectAdapter()
      await Promise.all([initBookmarks(adapter), initPreferences(adapter)])
    }
    bootstrap()
  }, [initBookmarks, initPreferences])

  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Main content */}
      <main className="px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            Loading bookmarks...
          </div>
        ) : (
          <BookmarkGrid />
        )}
      </main>

      {/* FAB buttons */}
      <div className="fixed bottom-6 right-6 z-10 flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="icon" onClick={cycleTheme} aria-label="Toggle theme" />}>
            <HugeiconsIcon icon={themeIcon[theme]} size={18} />
          </TooltipTrigger>
          <TooltipContent side="left" className="capitalize">{theme}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="icon" onClick={openSettings} aria-label="Settings" />}>
            <HugeiconsIcon icon={Settings03Icon} size={18} />
          </TooltipTrigger>
          <TooltipContent side="left">Settings</TooltipContent>
        </Tooltip>
      </div>

      {/* Dialogs */}
      <SettingsDialog />
      <BookmarkEditorDialog />
      <DeleteConfirmDialog />
    </div>
  )
}

export default App
