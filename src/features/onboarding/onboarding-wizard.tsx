import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore, type ColorTheme } from "@/stores/preferences-store"
import { useTheme } from "@/components/theme-provider"
import { WelcomeStep } from "./steps/welcome-step"
import { RootFolderStep } from "./steps/root-folder-step"
import { AppearanceStep } from "./steps/appearance-step"
import { DoneStep } from "./steps/done-step"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type ThemeMode = "light" | "dark" | "system"

const TOTAL_STEPS = 4

interface OnboardingWizardProps {
  onComplete: () => void
}

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [currentStep, setCurrentStep] = React.useState(0)

  // Local wizard state
  const [rootFolderId, setRootFolderId] = React.useState<string | null>(null)
  const [colorTheme, setColorTheme] = React.useState<ColorTheme>("default")
  const [themeMode, setThemeMode] = React.useState<ThemeMode>("dark")

  // Store actions for persisting on completion
  const setStoreRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const setStoreColorTheme = usePreferencesStore((s) => s.setColorTheme)
  const adapter = usePreferencesStore((s) => s.adapter)
  const { setTheme } = useTheme()

  // Apply theme changes live as the user selects them
  const handleColorThemeChange = React.useCallback(
    (theme: ColorTheme) => {
      setColorTheme(theme)
      // Apply live so the user sees the change behind the blur
      usePreferencesStore.getState().setColorTheme(theme)
    },
    []
  )

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

  const handleComplete = async () => {
    // Persist all selections
    setStoreRootFolderId(rootFolderId)
    setStoreColorTheme(colorTheme)
    setTheme(themeMode)

    // Set onboarding completed flag
    await adapter?.storage.set("onboardingCompleted", true)

    onComplete()
  }

  const handleSkip = async () => {
    // Preserve any root folder selection already made, use defaults for the rest
    setStoreRootFolderId(rootFolderId)
    setStoreColorTheme("default")
    setTheme("dark")

    await adapter?.storage.set("onboardingCompleted", true)

    onComplete()
  }

  const nextButtonText = (() => {
    switch (currentStep) {
      case 0: return "Get Started"
      case TOTAL_STEPS - 1: return "Start Browsing"
      default: return "Next"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xl animate-in fade-in duration-200">
      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        {/* Skip link */}
        {currentStep > 0 && currentStep < TOTAL_STEPS - 1 && (
          <button
            onClick={handleSkip}
            className="absolute top-4 right-4 text-xs text-muted-foreground hover:text-foreground transition-colors"
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
            {[
              <WelcomeStep key="welcome" />,
              <RootFolderStep key="root-folder" value={rootFolderId} onChange={setRootFolderId} />,
              <AppearanceStep
                key="appearance"
                colorTheme={colorTheme}
                onColorThemeChange={handleColorThemeChange}
                themeMode={themeMode}
                onThemeModeChange={handleThemeModeChange}
              />,
              <DoneStep key="done" />,
            ].map((step, i) => (
              <div key={i} className="w-full px-1 flex-shrink-0">
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

          <Button onClick={handleNextClick}>
            {nextButtonText}
          </Button>
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
