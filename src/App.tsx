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
} from "@hugeicons/core-free-icons"
import { useTheme } from "@/components/theme-provider"
import { COLOR_THEMES, type ColorTheme } from "@/stores/preferences-store"

export function App() {
  const initBookmarks = useBookmarkStore((s) => s.init)
  const initPreferences = usePreferencesStore((s) => s.init)
  const openSettings = useUIStore((s) => s.openSettings)
  const isLoading = useBookmarkStore((s) => s.isLoading)
  const colorTheme = usePreferencesStore((s) => s.colorTheme)
  const setColorTheme = usePreferencesStore((s) => s.setColorTheme)
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
      <div className="fixed bottom-6 right-6 z-10 flex items-center gap-2">
        {/* Dropdown theme picker */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="icon" aria-label="Pick color theme">
                <HugeiconsIcon icon={PaintBucketIcon} size={18} />
              </Button>
            }
          />
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
          <TooltipTrigger render={<Button variant="outline" size="icon" onClick={cycleTheme} aria-label="Toggle theme" />}>
            <HugeiconsIcon icon={themeIcon[theme]} size={18} />
          </TooltipTrigger>
          <TooltipContent side="top" className="capitalize">{theme}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button variant="outline" size="icon" onClick={openSettings} aria-label="Settings" />}>
            <HugeiconsIcon icon={Settings03Icon} size={18} />
          </TooltipTrigger>
          <TooltipContent side="top">Settings</TooltipContent>
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
