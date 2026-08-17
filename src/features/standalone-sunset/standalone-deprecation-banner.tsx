import * as React from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { useUIStore } from "@/stores/ui-store"
import { useSourceStore } from "@/stores/source-store"
import { STANDALONE_DEPRECATION_MESSAGE } from "./standalone-migration"

/**
 * The persistent deprecation notice shown while the Active Source is the
 * Standalone Source. Dismissing it hides the banner for the session only —
 * the sunset warning comes back on the next load until the profile migrates
 * or the removal release deletes the source.
 */
export function StandaloneDeprecationBanner() {
  const activeSourceId = useSourceStore((s) => s.activeSourceId)
  const openSettings = useUIStore((s) => s.openSettings)
  const [dismissed, setDismissed] = React.useState(false)

  if (activeSourceId !== "standalone" || dismissed) return null

  return (
    <Alert className="mx-auto mb-4 max-w-2xl border-amber-500/50">
      <AlertTitle>Standalone bookmarks are going away</AlertTitle>
      <AlertDescription className="flex flex-col gap-2">
        <span>{STANDALONE_DEPRECATION_MESSAGE}</span>
        <span className="flex gap-2">
          <Button size="sm" onClick={openSettings}>
            Migrate now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
            Dismiss for now
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  )
}
