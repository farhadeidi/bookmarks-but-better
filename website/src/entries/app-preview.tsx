/**
 * The marketing site's live preview: the real application, running against
 * the Dev Workbench's simulated world inside the hero iframe.
 *
 * The parent page drives appearance over postMessage ({ type: PREVIEW_MESSAGE,
 * mode?, colorTheme? }); the initial appearance arrives as URL parameters so
 * the first paint already matches the embedding site.
 */
import * as React from "react"
import { createRoot } from "react-dom/client"
import "./app-preview.css"
import App from "@/App"
import { ThemeProvider, useTheme } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  usePreferencesStore,
  type ColorTheme,
} from "@/stores/preferences-store"

const PREVIEW_MESSAGE = "bbb-preview/appearance"
const PREVIEW_STATE = "bbb-preview/state"
const COLOR_THEMES: readonly string[] = [
  "default",
  "amber-minimal",
  "bubblegum",
  "caffeine",
  "claude",
  "claymorphism",
  "cyberpunk",
  "solar-dusk",
  "t3-chat",
  "vintage-paper",
]

function isColorTheme(value: unknown): value is ColorTheme {
  return typeof value === "string" && COLOR_THEMES.includes(value)
}

function isMode(value: unknown): value is "dark" | "light" {
  return value === "dark" || value === "light"
}

function PreviewBridge() {
  const { setTheme } = useTheme()
  const colorTheme = usePreferencesStore((s) => s.colorTheme)

  // Report the app's actual theme upward, so the embedding page's controls
  // follow the real state — including changes made inside the preview's own
  // settings, and the hydrated preference on a later visit.
  React.useEffect(() => {
    window.parent?.postMessage({ type: PREVIEW_STATE, colorTheme }, "*")
  }, [colorTheme])

  React.useEffect(() => {
    const apply = (mode: unknown, colorTheme: unknown) => {
      if (isMode(mode)) setTheme(mode)
      if (isColorTheme(colorTheme)) {
        usePreferencesStore.getState().setColorTheme(colorTheme)
      }
    }

    const params = new URLSearchParams(window.location.search)
    apply(params.get("mode"), params.get("theme"))

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return
      const data = event.data as {
        type?: unknown
        mode?: unknown
        colorTheme?: unknown
      }
      if (data && data.type === PREVIEW_MESSAGE) {
        apply(data.mode, data.colorTheme)
      }
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [setTheme])

  return null
}

const initialMode = (() => {
  try {
    const param = new URLSearchParams(window.location.search).get("mode")
    return isMode(param) ? param : "dark"
  } catch {
    return "dark"
  }
})()

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider defaultTheme={initialMode}>
      <TooltipProvider>
        <PreviewBridge />
        <App />
      </TooltipProvider>
    </ThemeProvider>
  </React.StrictMode>
)
