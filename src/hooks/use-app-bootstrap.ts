import * as React from "react"
import { detectAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { getScreenshotMode } from "@/hooks/use-screenshot-mode"

/**
 * Detects the active adapter and initializes the bookmark and preferences
 * stores, then decides whether onboarding should be shown.
 *
 * Runs as a single async effect, so the cleanup has to guard against the
 * effect being torn down (StrictMode double-invoke, or a real unmount)
 * before `detectAdapter`/`init` resolve — otherwise the bookmark store's
 * change-listener subscriptions leak.
 */
export function useAppBootstrap() {
  const initBookmarks = useBookmarkStore((s) => s.init)
  const initPreferences = usePreferencesStore((s) => s.init)
  const [showOnboarding, setShowOnboarding] = React.useState(false)
  const [onboardingChecked, setOnboardingChecked] = React.useState(false)
  const screenshotMode = React.useMemo(() => getScreenshotMode(), [])

  React.useEffect(() => {
    let cancelled = false
    let cleanupBookmarks: (() => void) | undefined

    async function bootstrap() {
      const adapter = await detectAdapter()
      const [bookmarksCleanup] = await Promise.all([
        initBookmarks(adapter),
        initPreferences(adapter),
      ])

      if (cancelled) {
        bookmarksCleanup?.()
        return
      }
      cleanupBookmarks = bookmarksCleanup ?? undefined

      if (screenshotMode === "onboarding") {
        setShowOnboarding(true)
      } else if (!screenshotMode) {
        const onboardingCompleted = await adapter.storage.get<boolean>(
          "onboardingCompleted"
        )
        if (!cancelled && !onboardingCompleted) {
          setShowOnboarding(true)
        }
      }
      // screenshotMode === 'default': showOnboarding stays false (suppressed)

      if (!cancelled) {
        setOnboardingChecked(true)
      }
    }

    bootstrap()

    return () => {
      cancelled = true
      cleanupBookmarks?.()
    }
  }, [initBookmarks, initPreferences, screenshotMode])

  return {
    showOnboarding,
    setShowOnboarding,
    onboardingChecked,
    screenshotMode,
  }
}
