/**
 * The live preview launcher. The page ships a static screenshot; the real app
 * (the /app-preview/ build) is only loaded into an iframe when the visitor
 * asks for it — the "Try it live" button, a theme dot, or a theme in the
 * gallery — or right away on the full-screen /preview/ page.
 *
 * Once loaded, the frame follows the site's dark/light mode and the chosen
 * color theme over postMessage, and reports its actual theme back so the
 * dots always show the truth.
 */

export const PICK_THEME_EVENT = "bbb:pick-theme"

const PREVIEW_MESSAGE = "bbb-preview/appearance"
const PREVIEW_STATE = "bbb-preview/state"

const FRAME_CLASS = "block w-full border-0 bg-background"
const FRAME_HEIGHT = "h-[560px] md:h-auto md:aspect-[16/10]"
const FRAME_HEIGHT_TALL = "h-[75vh] min-h-[560px]"

function siteMode(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

function setup(root: HTMLElement) {
  const stage = root.querySelector<HTMLElement>("[data-preview-stage]")
  if (!stage) return
  const dots = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-preview-theme]"),
  ]
  const themeName = root.querySelector<HTMLElement>("[data-preview-theme-name]")
  const themeIds = new Set(dots.map((dot) => dot.dataset.previewTheme))
  let active = root.dataset.defaultTheme ?? ""
  let frame: HTMLIFrameElement | null = null

  const markActive = (id: string) => {
    active = id
    for (const dot of dots) {
      const selected = dot.dataset.previewTheme === id
      dot.setAttribute("aria-pressed", String(selected))
      if (selected && themeName) themeName.textContent = dot.title
    }
  }

  const send = (appearance: { mode?: string; colorTheme?: string }) => {
    frame?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, ...appearance },
      window.location.origin
    )
  }

  const launch = (theme: string, focus: boolean) => {
    if (frame) return
    const params = new URLSearchParams({ mode: siteMode(), theme })
    frame = document.createElement("iframe")
    frame.src = `/app-preview/?${params}`
    frame.title = "Bookmarks But Better — live preview of the real extension"
    frame.className = `${FRAME_CLASS} ${
      root.hasAttribute("data-tall") ? FRAME_HEIGHT_TALL : FRAME_HEIGHT
    }`
    stage.replaceChildren(frame)
    root.dataset.state = "live"
    markActive(theme)
    if (focus) frame.focus()
  }

  const pick = (id: string | undefined) => {
    if (!id || !themeIds.has(id)) return
    if (frame) {
      send({ colorTheme: id })
      markActive(id)
    } else {
      launch(id, false)
    }
  }

  root
    .querySelector("[data-preview-launch]")
    ?.addEventListener("click", () => launch(active, true))
  for (const dot of dots) {
    dot.addEventListener("click", () => pick(dot.dataset.previewTheme))
  }
  window.addEventListener(PICK_THEME_EVENT, (event) =>
    pick((event as CustomEvent<string>).detail)
  )

  // Follow the site's dark/light toggle.
  new MutationObserver(() => send({ mode: siteMode() })).observe(
    document.documentElement,
    { attributes: true, attributeFilter: ["class"] }
  )

  // Follow the app's actual theme, whichever side changed it.
  window.addEventListener("message", (event) => {
    if (!frame || event.source !== frame.contentWindow) return
    const data = event.data as { type?: string; colorTheme?: unknown }
    if (data?.type === PREVIEW_STATE && typeof data.colorTheme === "string") {
      markActive(data.colorTheme)
    }
  })

  if (root.hasAttribute("data-autoload")) launch(active, false)
}

export function initAppPreviews() {
  document.querySelectorAll<HTMLElement>("[data-app-preview]").forEach(setup)
}
