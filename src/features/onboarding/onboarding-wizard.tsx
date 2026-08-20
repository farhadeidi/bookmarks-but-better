import * as React from "react"
import type { BookmarkNode } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { SourceStep, type OnboardingSourceChoice } from "./steps/source-step"
import { DaemonSetupStep } from "./steps/daemon-setup-step"
import { RootFolderStep } from "./steps/root-folder-step"
import { TipsStep } from "./steps/tips-step"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  platformCapabilities,
  type PlatformCapabilities,
} from "@/sources/platform"
import {
  buildRootFolderOptions,
  resolveEffectiveCreateParentId,
} from "@/features/root-folder-select"
import { setOnboardingCompleted } from "@/browser/onboarding-preference"

interface OnboardingWizardProps {
  onComplete: () => void
}

/**
 * Whether asking "where do your bookmarks live?" is a question at all here.
 *
 * It is one only where this platform offers more than one source: a Browser
 * Source *and* daemon connections. The daemon-served build serves its own
 * same-origin Vault, a platform without the bookmarks API has nothing but the
 * daemon, and a runtime that cannot reach a daemon has nothing but the
 * browser — in each case there is one answer, so the step is omitted rather
 * than shown with a single option.
 */
function hasSourceChoice(caps: PlatformCapabilities): boolean {
  return caps.isExtension && caps.browserSource && caps.daemonSource
}

/**
 * Whether connecting a daemon is the only way into this profile, which makes
 * the daemon-setup step part of the track rather than a follow-up to a choice.
 * This is the Safari shape: an extension with daemon connections and no
 * Browser Source.
 */
function requiresDaemonSetup(caps: PlatformCapabilities): boolean {
  return caps.isExtension && !caps.browserSource && caps.daemonSource
}

/**
 * Whether pointing the dashboard at a folder is a question at all here.
 *
 * It is one only where the tree offers somewhere to point: a folder to select,
 * or a real parent to create one under. With neither — an empty tree, or the
 * daemon-only profile that has not connected anything yet — the picker's only
 * entry is "all bookmarks", which is exactly what choosing nothing already
 * means, so the step would be a dead end rather than a decision. Connecting a
 * daemon on the previous step brings a tree with it, and the step appears.
 */
function hasRootFolderChoice(
  tree: BookmarkNode[],
  rootIsCreatable: boolean
): boolean {
  return (
    buildRootFolderOptions(tree).length > 0 ||
    resolveEffectiveCreateParentId(tree, rootIsCreatable) !== null
  )
}

/**
 * The wizard's source choice, normalized to what this platform offers: the
 * Browser Source when it exists, otherwise the Daemon Source — the only
 * offered source on a capability-only (Safari) platform.
 */
function initialSourceChoice(
  caps: PlatformCapabilities
): OnboardingSourceChoice {
  return caps.browserSource ? "browser" : "daemon"
}

/**
 * Setup, reduced to the questions this platform actually has to ask, then one
 * card that teaches what nothing on screen would.
 *
 * There is no welcome step (a logo costs a click and teaches nothing) and no
 * appearance step: Settings owns theme and color mode, and neither is needed
 * to see a bookmark. That also means the wizard now writes no appearance
 * preference at all — re-opening it from Settings and skipping used to reset
 * the user's theme to the defaults.
 */
export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = React.useState(0)

  // Resolved once per mount: capabilities do not change under a running page.
  const [caps] = React.useState(platformCapabilities)

  // Local wizard state. There is no source choice to persist: the default
  // profile already has Browser enabled and active, and connecting a
  // daemon — the only other choice — persists through the connect flow
  // itself. The choice only gates whether the daemon-setup step appears,
  // so it starts on the sole offered source: when the Browser Source does
  // not exist here, daemon is already chosen and Next cannot skip the
  // daemon setup.
  const [sourceChoice, setSourceChoice] =
    React.useState<OnboardingSourceChoice>(() => initialSourceChoice(caps))
  const [rootFolderId, setRootFolderId] = React.useState<string | null>(null)

  // Store actions for persisting on completion
  const setStoreRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const adapter = usePreferencesStore((s) => s.adapter)

  // Start the root-folder step on something meaningful rather than "Browser
  // Root (all bookmarks)", which shows every bookmark the user owns. Seeded
  // once, and only until the user touches the select — `null` is a legitimate
  // choice there, so this cannot re-run and quietly undo it. An already-saved
  // root wins, since re-opening the wizard from Settings shouldn't silently
  // repoint an existing dashboard.
  const hasSeededRootFolder = React.useRef(false)
  const bookmarkTree = useBookmarkStore((s) => s.tree)
  const bookmarkAdapter = useBookmarkStore((s) => s.adapter)
  const rootIsCreatable = bookmarkAdapter?.capabilities.rootIsCreatable ?? false
  React.useEffect(() => {
    if (hasSeededRootFolder.current || bookmarkTree.length === 0) return
    hasSeededRootFolder.current = true

    setRootFolderId(
      useBookmarkStore.getState().rootFolderId ??
        resolveEffectiveCreateParentId(bookmarkTree, rootIsCreatable)
    )
  }, [bookmarkTree, rootIsCreatable])

  const showSourceStep = hasSourceChoice(caps)
  // Mandatory where the daemon is the only source: it is on the track whatever
  // the user does, rather than sitting behind a choice they were never given.
  const showDaemonSetupStep =
    requiresDaemonSetup(caps) || (showSourceStep && sourceChoice === "daemon")
  const showRootFolderStep = hasRootFolderChoice(bookmarkTree, rootIsCreatable)

  const steps = React.useMemo(() => {
    const list: React.ReactNode[] = []
    if (showSourceStep) {
      list.push(
        <SourceStep
          key="source"
          value={sourceChoice}
          onChange={setSourceChoice}
        />
      )
    }
    if (showDaemonSetupStep) {
      list.push(<DaemonSetupStep key="daemon-setup" />)
    }
    if (showRootFolderStep) {
      list.push(
        <RootFolderStep
          key="root-folder"
          value={rootFolderId}
          onChange={setRootFolderId}
        />
      )
    }
    list.push(<TipsStep key="tips" />)
    return list
  }, [
    sourceChoice,
    showSourceStep,
    showDaemonSetupStep,
    showRootFolderStep,
    rootFolderId,
  ])

  const TOTAL_STEPS = steps.length

  // Toggling a step in or out of the list can leave `currentStep` pointing
  // past the end (or, if the user is still ahead of it, at the wrong step) —
  // clamp it back onto the track rather than rendering blank.
  React.useEffect(() => {
    setCurrentStep((s) => Math.min(s, TOTAL_STEPS - 1))
  }, [TOTAL_STEPS])

  const goNext = () => {
    if (currentStep < TOTAL_STEPS - 1) {
      setCurrentStep((s) => s + 1)
    }
  }

  const goBack = () => {
    if (currentStep > 0) {
      setCurrentStep((s) => s - 1)
    }
  }

  /**
   * Finishing and skipping are the same write now that appearance is gone:
   * the only thing the wizard still persists is the root folder, and skipping
   * keeps whatever it is already on — the seeded default when the user never
   * reached the step. The source choice needs no write of its own: a fresh
   * profile already starts on the source its platform offers, and choosing
   * the daemon persists through the daemon-setup step's Connect flow.
   */
  const finish = async () => {
    setStoreRootFolderId(rootFolderId)

    // The global value survives adapter changes. Keep the legacy adapter value
    // too so a downgrade to v3 does not show onboarding again.
    await Promise.all([
      setOnboardingCompleted(true),
      adapter?.storage.set("onboardingCompleted", true),
    ])

    onComplete()
  }

  const isLastStep = currentStep === TOTAL_STEPS - 1

  const handleNextClick = () => {
    if (isLastStep) {
      finish()
    } else {
      goNext()
    }
  }

  return (
    // Overlay with blur
    <div className="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/50 backdrop-blur-xl duration-200 fade-in">
      {/* Modal */}
      <div className="relative w-full max-w-lg animate-in rounded-xl border border-border bg-card p-6 shadow-2xl duration-200 zoom-in-95 fade-in">
        {/* Skip link — raised above the sliding step content so real-browser
            hit testing reaches it (the steps are plain in-flow blocks that
            would otherwise intercept the click). Offered from the very first
            step: every step before the last one is now a question, and the
            last one asks nothing to skip. */}
        {!isLastStep && (
          <button
            onClick={finish}
            className="absolute top-4 right-4 z-10 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip, use defaults
          </button>
        )}

        {/* Step content with slide animation */}
        <div className="overflow-hidden">
          <div
            className="flex transition-transform duration-300 ease-in-out"
            style={{ transform: `translateX(-${currentStep * 100}%)` }}
          >
            {steps.map((step, i) => (
              <div key={i} className="w-full flex-shrink-0 px-1">
                {step}
              </div>
            ))}
          </div>
        </div>

        {/* Navigation */}
        <div className="mt-6 flex items-center justify-between">
          <div>
            {currentStep > 0 && (
              <Button variant="ghost" onClick={goBack}>
                Back
              </Button>
            )}
          </div>

          <Button onClick={handleNextClick}>
            {isLastStep ? "Start Browsing" : "Next"}
          </Button>
        </div>

        {/* Step dots — a single-step wizard is not a track, so it shows none. */}
        {TOTAL_STEPS > 1 && (
          <div className="mt-4 flex justify-center gap-2">
            {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 w-1.5 rounded-full transition-colors",
                  i === currentStep ? "bg-primary" : "bg-muted-foreground/30"
                )}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
