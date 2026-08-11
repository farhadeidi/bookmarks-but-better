import * as React from "react"
import { detectAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"
import { getScreenshotMode } from "@/hooks/use-screenshot-mode"
import {
  getOnboardingCompleted,
  setOnboardingCompleted,
} from "@/browser/onboarding-preference"

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
  const openOnboarding = useUIStore((s) => s.openOnboarding)
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
        openOnboarding()
      } else if (!screenshotMode) {
        let onboardingCompleted = await getOnboardingCompleted()

        // v2-v3 stored this flag behind the active adapter. Import a completed
        // setup into the adapter-independent key once, so changing bookmark
        // sources in v4 can never make an established user look new again.
        if (onboardingCompleted === null) {
          const legacyCompleted = await adapter.storage.get<boolean>(
            "onboardingCompleted"
          )
          onboardingCompleted = legacyCompleted === true
          if (onboardingCompleted) {
            await setOnboardingCompleted(true)
          }
        }

        if (!cancelled && !onboardingCompleted) {
          openOnboarding()
        }
      }
      // screenshotMode === 'default': onboarding stays hidden (suppressed)

      if (!cancelled) {
        setOnboardingChecked(true)
      }
    }

    bootstrap()

    return () => {
      cancelled = true
      cleanupBookmarks?.()
    }
  }, [initBookmarks, initPreferences, openOnboarding, screenshotMode])

  return {
    onboardingChecked,
    screenshotMode,
  }
}
