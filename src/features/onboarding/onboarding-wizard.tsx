import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useSourceStore } from "@/stores/source-store"
import { SourceStep } from "./steps/source-step"
import { DaemonSetupStep } from "./steps/daemon-setup-step"
import { RootFolderStep } from "./steps/root-folder-step"
import { TipsStep } from "./steps/tips-step"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import {
  platformCapabilities,
  type PlatformCapabilities,
} from "@/sources/platform"
import {
  hasRootFolderChoice,
  resolveEffectiveCreateParentId,
} from "@/features/root-folder-select"
import { findNodeById } from "@/lib/bookmark-utils"
import { BROWSER_SOURCE_ID } from "@/sources/config"
import { setOnboardingCompleted } from "@/browser/onboarding-preference"

interface OnboardingWizardProps {
  onComplete: () => void
}

/**
 * Whether there is anything to say about sources at all here.
 *
 * Only where this platform offers more than one: a Browser Source *and*
 * daemon connections. The daemon-served build serves its own same-origin
 * Vault, a platform without the bookmarks API has nothing but the daemon, and
 * a runtime that cannot reach a daemon has nothing but the browser — in each
 * case there is nothing to add, so the step is omitted.
 */
function hasSourceChoice(caps: PlatformCapabilities): boolean {
  return caps.isExtension && caps.browserSource && caps.daemonSource
}

/**
 * Whether connecting a daemon is the only way into this profile, which makes
 * the vault step part of the track rather than a follow-up to an opt-in. This
 * is the Safari shape: an extension with daemon connections and no Browser
 * Source.
 */
function requiresDaemonSetup(caps: PlatformCapabilities): boolean {
  return caps.isExtension && !caps.browserSource && caps.daemonSource
}

/** Before the first seed: distinct from every adapter, including none. */
const NOT_SEEDED = Symbol("not seeded")

/**
 * Setup, reduced to the questions this platform actually has to ask, then one
 * card that teaches what nothing on screen would.
 *
 * There is no welcome step (a logo costs a click and teaches nothing) and no
 * appearance step: Settings owns theme and color mode, and neither is needed
 * to see a bookmark. The wizard writes no appearance preference at all.
 *
 * It is a real dialog: focus stays inside, Escape skips setup, and only the
 * current step is rendered, so the dialog is as tall as that step.
 */
export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = React.useState(0)

  // Resolved once per mount: capabilities do not change under a running page.
  const [caps] = React.useState(platformCapabilities)

  // Which sources the user wants. The default profile already has Browser
  // enabled and active, and connecting a vault persists through the connect
  // flow itself, so `addVault` only puts the vault step on the track and
  // `useBrowser` is applied on finish — and only once a vault is there to take
  // over, since the last enabled source cannot be disabled.
  const [useBrowser, setUseBrowser] = React.useState(true)
  const [addVault, setAddVault] = React.useState(false)
  // At least one stays on: switching one off switches the other on.
  const changeUseBrowser = (on: boolean) => {
    setUseBrowser(on)
    if (!on) setAddVault(true)
  }
  const changeAddVault = (on: boolean) => {
    setAddVault(on)
    if (!on) setUseBrowser(true)
  }
  const [rootFolderId, setRootFolderId] = React.useState<string | null>(null)

  const setStoreRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const setSourceEnabled = useSourceStore((s) => s.setSourceEnabled)
  const adapter = usePreferencesStore((s) => s.adapter)
  const hasConnection = useSourceStore(
    (s) => Object.keys(s.config.connections).length > 0
  )

  // Start the root-folder step on something meaningful rather than "Browser
  // Root (all bookmarks)", which shows every bookmark the user owns. An
  // already-saved root wins, since re-opening the wizard from Settings
  // shouldn't silently repoint an existing dashboard.
  //
  // Seeded per adapter, not once: connecting a vault mid-wizard switches the
  // Active Source, and a folder id from the browser tree means nothing in the
  // vault's. A choice that no longer exists in the tree is re-seeded too, which
  // covers the tree arriving after its adapter.
  const seededFor = React.useRef<unknown>(NOT_SEEDED)
  const bookmarkTree = useBookmarkStore((s) => s.tree)
  const bookmarkAdapter = useBookmarkStore((s) => s.adapter)
  const rootIsCreatable = bookmarkAdapter?.capabilities.rootIsCreatable ?? false
  React.useEffect(() => {
    if (bookmarkTree.length === 0) return
    const stale =
      rootFolderId !== null && !findNodeById(bookmarkTree, rootFolderId)
    if (seededFor.current === bookmarkAdapter && !stale) return
    seededFor.current = bookmarkAdapter

    const saved = useBookmarkStore.getState().rootFolderId
    setRootFolderId(
      saved && findNodeById(bookmarkTree, saved)
        ? saved
        : resolveEffectiveCreateParentId(bookmarkTree, rootIsCreatable)
    )
  }, [bookmarkTree, bookmarkAdapter, rootIsCreatable, rootFolderId])

  const showSourceStep = hasSourceChoice(caps)
  // Mandatory where the daemon is the only source: it is on the track whatever
  // the user does, rather than sitting behind an opt-in they were never given.
  const showDaemonSetupStep =
    requiresDaemonSetup(caps) || (showSourceStep && addVault)
  const showRootFolderStep = hasRootFolderChoice(bookmarkTree, rootIsCreatable)

  const steps = React.useMemo(() => {
    const list: { key: string; node: React.ReactNode }[] = []
    if (showSourceStep) {
      list.push({
        key: "source",
        node: (
          <SourceStep
            useBrowser={useBrowser}
            onUseBrowserChange={changeUseBrowser}
            addVault={addVault}
            onAddVaultChange={changeAddVault}
          />
        ),
      })
    }
    if (showDaemonSetupStep) {
      list.push({
        key: "daemon-setup",
        node: <DaemonSetupStep browserOff={showSourceStep && !useBrowser} />,
      })
    }
    if (showRootFolderStep) {
      list.push({
        key: "root-folder",
        node: (
          <RootFolderStep value={rootFolderId} onChange={setRootFolderId} />
        ),
      })
    }
    list.push({ key: "tips", node: <TipsStep /> })
    return list
  }, [
    useBrowser,
    addVault,
    showSourceStep,
    showDaemonSetupStep,
    showRootFolderStep,
    rootFolderId,
  ])

  const TOTAL_STEPS = steps.length

  // Toggling a step in or out of the list can leave `currentStep` pointing
  // past the end — clamp it back onto the track rather than rendering blank.
  React.useEffect(() => {
    setCurrentStep((s) => Math.min(s, TOTAL_STEPS - 1))
  }, [TOTAL_STEPS])

  const step = steps[Math.min(currentStep, TOTAL_STEPS - 1)]
  const isLastStep = currentStep >= TOTAL_STEPS - 1

  const goNext = () => {
    if (currentStep < TOTAL_STEPS - 1) setCurrentStep((s) => s + 1)
  }

  const goBack = () => {
    if (currentStep > 0) setCurrentStep((s) => s - 1)
  }

  /**
   * Finishing and skipping are the same write: the only thing the wizard
   * persists is the root folder, and skipping keeps whatever it is already on
   * — the seeded default when the user never reached the step. A choice that
   * is not in the Active Source's tree is never written into it.
   *
   * Browser bookmarks switched off is honored only when a vault is connected:
   * with nothing else enabled the store would refuse, and the dashboard would
   * have nothing to show.
   */
  const finish = async () => {
    if (showSourceStep && !useBrowser && hasConnection) {
      await setSourceEnabled(BROWSER_SOURCE_ID, false)
    }

    const tree = useBookmarkStore.getState().tree
    if (rootFolderId === null || findNodeById(tree, rootFolderId)) {
      setStoreRootFolderId(rootFolderId)
    }

    // The global value survives adapter changes. Keep the legacy adapter value
    // too so a downgrade to v3 does not show onboarding again.
    await Promise.all([
      setOnboardingCompleted(true),
      adapter?.storage.set("onboardingCompleted", true),
    ])

    onComplete()
  }

  const handleNextClick = () => {
    if (isLastStep) void finish()
    else goNext()
  }

  // Before a vault is connected, Connect is the step's action; moving on
  // without one stays available but reads as the secondary choice.
  const skippingVault = step.key === "daemon-setup" && !hasConnection
  const nextLabel = isLastStep
    ? "Open dashboard"
    : skippingVault
      ? "Skip for now"
      : "Next"

  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(open) => {
        // Escape is the only way to close it from here: it skips setup.
        if (!open) void finish()
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-label="Set up Bookmarks But Better"
        className="flex max-h-[calc(100svh-2rem)] flex-col gap-6 overflow-y-auto bg-card sm:max-w-lg"
      >
        {TOTAL_STEPS > 1 && (
          <p className="text-xs font-medium text-muted-foreground">
            Step {currentStep + 1} of {TOTAL_STEPS}
          </p>
        )}

        <div key={step.key} className="animate-in duration-200 fade-in">
          {step.node}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div>
            {currentStep > 0 && (
              <Button variant="ghost" onClick={goBack}>
                Back
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* On every step but the last, which asks nothing to skip — so
                exactly one of "Skip setup" and "Open dashboard" exists at a
                time, the invariant the e2e suites lean on. */}
            {!isLastStep && (
              <Button variant="ghost" onClick={() => void finish()}>
                Skip setup
              </Button>
            )}
            <Button
              variant={skippingVault ? "outline" : "default"}
              onClick={handleNextClick}
            >
              {nextLabel}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
