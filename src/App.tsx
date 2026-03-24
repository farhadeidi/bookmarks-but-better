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
import { Settings02Icon } from "@hugeicons/core-free-icons"

export function App() {
  const initBookmarks = useBookmarkStore((s) => s.init)
  const initPreferences = usePreferencesStore((s) => s.init)
  const openSettings = useUIStore((s) => s.openSettings)
  const isLoading = useBookmarkStore((s) => s.isLoading)

  React.useEffect(() => {
    async function bootstrap() {
      const adapter = await detectAdapter()
      await Promise.all([initBookmarks(adapter), initPreferences(adapter)])
    }
    bootstrap()
  }, [initBookmarks, initPreferences])

  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-end p-4">
        <Tooltip>
          <TooltipTrigger render={<Button variant="ghost" size="icon" onClick={openSettings} aria-label="Settings" />}>
            <HugeiconsIcon icon={Settings02Icon} size={18} />
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>
      </header>

      {/* Main content */}
      <main className="px-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            Loading bookmarks...
          </div>
        ) : (
          <BookmarkGrid />
        )}
      </main>

      {/* Dialogs */}
      <SettingsDialog />
      <BookmarkEditorDialog />
      <DeleteConfirmDialog />
    </div>
  )
}

export default App
