import * as React from "react"
import { isBrowserExtension, migrateSyncToLocal } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useSourceStore } from "@/stores/source-store"
import { useUIStore } from "@/stores/ui-store"
import { getScreenshotMode } from "@/hooks/use-screenshot-mode"
import {
  getOnboardingCompleted,
  setOnboardingCompleted,
} from "@/browser/onboarding-preference"

/**
 * Initializes the source session and decides whether onboarding should be
 * shown.
 *
 * The source store owns adapter construction and the Source Session
 * transition; this hook only starts it once, performs the legacy
 * onboarding-flag import, and re-runs discovery in the background so vault
 * names stay fresh without blocking the dashboard.
 *
 * Runs as a single async effect, so the cleanup has to guard against the
 * effect being torn down (StrictMode double-invoke, or a real unmount)
 * before the initialization resolves.
 */
export function useAppBootstrap() {
  const initializeSources = useSourceStore((s) => s.initialize)
  const refreshDaemonVaults = useSourceStore((s) => s.refreshDaemonVaults)
  const openOnboarding = useUIStore((s) => s.openOnboarding)
  const [onboardingChecked, setOnboardingChecked] = React.useState(false)
  const screenshotMode = React.useMemo(() => getScreenshotMode(), [])

  React.useEffect(() => {
    let cancelled = false

    async function bootstrap() {
      // On a dev-server page the scenario world must exist before any
      // source is loaded. The guard is written inline so the build-time
      // constants fold it to `false` in production and rollup eliminates
      // the dynamic import — and everything it pulls in — entirely.
      if (import.meta.env.DEV && import.meta.env.MODE !== "test") {
        const { bootstrapDevWorkbench } = await import("@/dev/bootstrap")
        await bootstrapDevWorkbench()
      }

      // The Firefox profile-preference migration is a property of the
      // extension context, not of any source; it runs wherever the extension
      // APIs exist, exactly once.
      if (isBrowserExtension()) {
        await migrateSyncToLocal()
      }

      await initializeSources()
      if (cancelled) return

      // Names and hosted sets drift as daemons restart; refreshing them in
      // the background keeps the switcher honest without gating the first
      // paint on every connection.
      void refreshDaemonVaults()

      if (screenshotMode === "onboarding") {
        openOnboarding()
      } else if (!screenshotMode) {
        let onboardingCompleted = await getOnboardingCompleted()

        // v2-v3 stored this flag behind the active adapter. Import a
        // completed setup into the adapter-independent key once, so changing
        // bookmark sources can never make an established user look new
        // again.
        if (onboardingCompleted === null) {
          const adapter = useBookmarkStore.getState().adapter
          const legacyCompleted = await adapter?.storage.get<boolean>(
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
    }
  }, [initializeSources, refreshDaemonVaults, openOnboarding, screenshotMode])

  return {
    onboardingChecked,
    screenshotMode,
  }
}
