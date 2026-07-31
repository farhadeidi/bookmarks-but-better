import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import {
  usePreferencesStore,
  type ColorTheme,
} from "@/stores/preferences-store"
import { useTheme } from "@/components/theme-provider"
import { WelcomeStep } from "./steps/welcome-step"
import { ModeStep } from "./steps/mode-step"
import { DaemonSetupStep } from "./steps/daemon-setup-step"
import { RootFolderStep } from "./steps/root-folder-step"
import { AppearanceStep } from "./steps/appearance-step"
import { DoneStep } from "./steps/done-step"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { resolveEffectiveCreateParentId } from "@/features/root-folder-select"
import type { AdapterMode } from "@/browser/types"

type ThemeMode = "light" | "dark" | "system"

interface OnboardingWizardProps {
  onComplete: () => void
}

// The mode step (and its conditional daemon-setup follow-up) is skipped in
// the daemon-served build, since that build always serves its own
// same-origin daemon adapter — there is no choice to make there.
const SHOW_MODE_STEP = import.meta.env.VITE_BUILD_TARGET !== "daemon"

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = React.useState(0)

  // Local wizard state
  const [adapterMode, setAdapterModeLocal] = React.useState<AdapterMode>(
    usePreferencesStore.getState().adapterMode
  )
  const [rootFolderId, setRootFolderId] = React.useState<string | null>(null)
  const [colorTheme, setColorTheme] = React.useState<ColorTheme>("default")
  const [themeMode, setThemeMode] = React.useState<ThemeMode>("dark")

  // Store actions for persisting on completion
  const setStoreRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const setStoreColorTheme = usePreferencesStore((s) => s.setColorTheme)
  const setStoreAdapterMode = usePreferencesStore((s) => s.setAdapterMode)
  const adapter = usePreferencesStore((s) => s.adapter)
  const { setTheme } = useTheme()

  // Apply theme changes live as the user selects them
  const handleColorThemeChange = React.useCallback((theme: ColorTheme) => {
    setColorTheme(theme)
    // Apply live so the user sees the change behind the blur
    usePreferencesStore.getState().setColorTheme(theme)
  }, [])

  const handleThemeModeChange = React.useCallback(
    (mode: ThemeMode) => {
      setThemeMode(mode)
      setTheme(mode)
    },
    [setTheme]
  )

  // Apply dark mode on mount (wizard defaults to dark)
  React.useEffect(() => {
    setTheme("dark")
  }, [setTheme])

  // Start the root-folder step on something meaningful rather than "Browser
  // Root (all bookmarks)", which shows every bookmark the user owns. Seeded
  // once, and only until the user touches the select — `null` is a legitimate
  // choice there, so this cannot re-run and quietly undo it. An already-saved
  // root wins, since re-opening the wizard from Settings shouldn't silently
  // repoint an existing dashboard.
  const hasSeededRootFolder = React.useRef(false)
  const bookmarkTree = useBookmarkStore((s) => s.tree)
  const bookmarkAdapter = useBookmarkStore((s) => s.adapter)
  React.useEffect(() => {
    if (hasSeededRootFolder.current || bookmarkTree.length === 0) return
    hasSeededRootFolder.current = true

    setRootFolderId(
      useBookmarkStore.getState().rootFolderId ??
        resolveEffectiveCreateParentId(
          bookmarkTree,
          bookmarkAdapter?.capabilities.rootIsCreatable ?? false
        )
    )
  }, [bookmarkTree, bookmarkAdapter])

  const showDaemonSetupStep = SHOW_MODE_STEP && adapterMode === "daemon"

  const steps = React.useMemo(() => {
    const list: React.ReactNode[] = [<WelcomeStep key="welcome" />]
    if (SHOW_MODE_STEP) {
      list.push(
        <ModeStep
          key="mode"
          value={adapterMode}
          onChange={setAdapterModeLocal}
        />
      )
    }
    if (showDaemonSetupStep) {
      list.push(<DaemonSetupStep key="daemon-setup" />)
    }
    list.push(
      <RootFolderStep
        key="root-folder"
        value={rootFolderId}
        onChange={setRootFolderId}
      />,
      <AppearanceStep
        key="appearance"
        colorTheme={colorTheme}
        onColorThemeChange={handleColorThemeChange}
        themeMode={themeMode}
        onThemeModeChange={handleThemeModeChange}
      />,
      <DoneStep key="done" />
    )
    return list
  }, [
    adapterMode,
    showDaemonSetupStep,
    rootFolderId,
    colorTheme,
    themeMode,
    handleColorThemeChange,
    handleThemeModeChange,
  ])

  const TOTAL_STEPS = steps.length

  // Toggling the daemon step in or out of the list can leave `currentStep`
  // pointing past the end (or, if the user is still ahead of it, at the
  // wrong step) — clamp it back onto the track rather than rendering blank.
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

  const persistAdapterMode = () => {
    // Daemon mode is only ever persisted through `connectToDaemon`'s own
    // validate/permission/health-check flow (triggered from the daemon-setup
    // step's connection panel), never set directly here.
    if (adapterMode !== "daemon") {
      setStoreAdapterMode(adapterMode)
    }
  }

  const handleComplete = async () => {
    // Persist all selections
    persistAdapterMode()
    setStoreRootFolderId(rootFolderId)
    setStoreColorTheme(colorTheme)
    setTheme(themeMode)

    // Set onboarding completed flag
    await adapter?.storage.set("onboardingCompleted", true)

    onComplete()
  }

  const handleSkip = async () => {
    // Preserve any root folder and mode selection already made, use defaults
    // for the rest
    persistAdapterMode()
    setStoreRootFolderId(rootFolderId)
    setStoreColorTheme("default")
    setTheme("dark")

    await adapter?.storage.set("onboardingCompleted", true)

    onComplete()
  }

  const nextButtonText = (() => {
    switch (currentStep) {
      case 0:
        return "Get Started"
      case TOTAL_STEPS - 1:
        return "Start Browsing"
      default:
        return "Next"
    }
  })()

  const handleNextClick = () => {
    if (currentStep === TOTAL_STEPS - 1) {
      handleComplete()
    } else {
      goNext()
    }
  }

  return (
    // Overlay with blur
    <div className="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/50 backdrop-blur-xl duration-200 fade-in">
      {/* Modal */}
      <div className="relative w-full max-w-lg animate-in rounded-xl border border-border bg-card p-6 shadow-2xl duration-200 zoom-in-95 fade-in">
        {/* Skip link */}
        {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
          <button
            onClick={handleSkip}
            className="absolute top-4 right-4 text-xs text-muted-foreground transition-colors hover:text-foreground"
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
            {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
              <Button variant="ghost" onClick={goBack}>
                Back
              </Button>
            )}
          </div>

          <Button onClick={handleNextClick}>{nextButtonText}</Button>
        </div>

        {/* Step dots */}
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
      </div>
    </div>
  )
}
