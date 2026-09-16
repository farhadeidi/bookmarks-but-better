/**
 * The live preview page (/preview/). The real application is built separately
 * and served at /preview/app/; this puts it in a frame below the site header,
 * and wires the strip of theme dots above it.
 *
 * The frame is created here rather than written into the markup so its first
 * paint already matches the site: the mode and the colour theme travel as URL
 * parameters, which the app reads before it renders. After that the two sides
 * talk over postMessage — a dot sends a colour theme, the header's dark/light
 * toggle sends a mode, and the app reports whichever theme it actually settled
 * on, so the dots stay truthful when the visitor changes it inside the app.
 */

const APP_URL = "/preview/app/"
const PREVIEW_MESSAGE = "bbb-preview/appearance"
const PREVIEW_STATE = "bbb-preview/state"

const FRAME_CLASS = "block h-full w-full border-0 bg-background"
const FRAME_TITLE = "Bookmarks But Better — the live app, running on demo data"

function siteMode(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

export function initPreview(): void {
  const root = document.querySelector<HTMLElement>("[data-preview]")
  const stage = root?.querySelector<HTMLElement>("[data-preview-stage]")
  if (!root || !stage) return

  const dots = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-preview-theme]"),
  ]
  const known = new Set(dots.map((dot) => dot.dataset.previewTheme))

  // A shared /preview/?theme= link opens on that theme. Without one the app
  // keeps whatever the visitor last chose, and reports it back below.
  const requested = new URLSearchParams(window.location.search).get("theme")
  const initial = requested && known.has(requested) ? requested : ""

  const params = new URLSearchParams({ mode: siteMode() })
  if (initial) params.set("theme", initial)

  const frame = document.createElement("iframe")
  frame.src = `${APP_URL}?${params}`
  frame.title = FRAME_TITLE
  frame.className = FRAME_CLASS
  stage.replaceChildren(frame)

  const send = (appearance: { mode?: string; colorTheme?: string }) => {
    frame.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, ...appearance },
      window.location.origin
    )
  }

  /** Show which theme the app is on. */
  const markActive = (id: string) => {
    for (const dot of dots) {
      dot.setAttribute("aria-pressed", String(dot.dataset.previewTheme === id))
    }
  }

  if (initial) markActive(initial)

  for (const dot of dots) {
    dot.addEventListener("click", () => {
      const id = dot.dataset.previewTheme
      if (!id) return
      send({ colorTheme: id })
      markActive(id)
      // Keep the address bar on what is actually shown, so the view can be
      // shared and survives a reload. Replace, so Back still leaves the page.
      const url = new URL(window.location.href)
      url.searchParams.set("theme", id)
      history.replaceState(null, "", url)
    })
  }

  // Follow the header's dark/light toggle, which flips the class on <html>.
  new MutationObserver(() => send({ mode: siteMode() })).observe(
    document.documentElement,
    { attributes: true, attributeFilter: ["class"] }
  )

  // Follow the app's own theme, whichever side changed it.
  window.addEventListener("message", (event) => {
    if (event.source !== frame.contentWindow) return
    if (event.origin !== window.location.origin) return
    const data = event.data as { type?: string; colorTheme?: unknown }
    if (data?.type === PREVIEW_STATE && typeof data.colorTheme === "string") {
      markActive(data.colorTheme)
    }
  })
}
