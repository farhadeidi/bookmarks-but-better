import { useEffect, useRef, useState, type CSSProperties } from "react"
import { cn } from "@/lib/cn"
import { DEMO_THEMES, PICK_THEME_EVENT } from "@/lib/themes"

const PREVIEW_MESSAGE = "bbb-preview/appearance"
const PREVIEW_STATE = "bbb-preview/state"

function siteMode(): "dark" | "light" {
  return document.documentElement.classList.contains("dark") ? "dark" : "light"
}

/**
 * The real application, embedded live: an iframe of the preview build —
 * the actual app running against the Dev Workbench's simulated world.
 *
 * Parents (and the themes gallery) steer appearance through PICK_THEME_EVENT;
 * the frame follows the embedding site's dark/light mode. The app reports its
 * actual theme back, so the dots always show the truth — even when it was
 * changed inside the preview's own settings.
 */
export function AppPreview({
  className,
  bodyClassName,
  tall = false,
}: {
  className?: string
  bodyClassName?: string
  tall?: boolean
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const [activeTheme, setActiveTheme] = useState("amber-minimal")

  const send = (appearance: {
    mode?: "dark" | "light"
    colorTheme?: string
  }) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: PREVIEW_MESSAGE, ...appearance },
      window.location.origin
    )
  }

  useEffect(() => {
    // Follow the embedding site's dark/light mode.
    const observer = new MutationObserver(() => send({ mode: siteMode() }))
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    // Steer the preview from the hero dots and the themes gallery.
    const pick = (event: Event) => {
      const id = (event as CustomEvent<string>).detail
      if (DEMOTHEMES_HAS(id)) {
        send({ colorTheme: id })
        setActiveTheme(id)
      }
    }
    window.addEventListener(PICK_THEME_EVENT, pick)
    return () => window.removeEventListener(PICK_THEME_EVENT, pick)
  }, [])

  useEffect(() => {
    // Follow the app's actual theme, whichever side changed it.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data as { type?: string; colorTheme?: unknown }
      if (data?.type === PREVIEW_STATE && typeof data.colorTheme === "string") {
        setActiveTheme(data.colorTheme)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [])

  const theme = DEMO_THEMES.find((item) => item.id === activeTheme)
  const src = `/preview/?mode=${siteMode()}&theme=amber-minimal`

  return (
    <figure id="demo" className="scroll-mt-24">
      <div
        className={cn(
          "overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-foreground/10",
          className
        )}
        style={{ "--demo-accent": theme?.accent } as CSSProperties}
      >
        <div className="flex items-center gap-3 border-b border-border bg-muted/60 px-4 py-2.5">
          <div className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-foreground/15" />
            <span className="size-2.5 rounded-full bg-foreground/15" />
            <span className="size-2.5 rounded-full bg-foreground/15" />
          </div>
          <div className="flex h-7 max-w-xs flex-1 items-center rounded-md border border-border bg-background px-3 text-xs text-muted-foreground">
            New Tab
          </div>
        </div>
        <iframe
          ref={iframeRef}
          src={src}
          title="Bookmarks But Better — live preview of the real extension"
          className={cn(
            "block w-full border-0 bg-background",
            tall ? "h-[75vh] min-h-[560px]" : "h-[540px] md:h-[600px]",
            bodyClassName
          )}
        />
      </div>

      <figcaption className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
        <span className="text-xs text-muted-foreground">
          This is the real app, live — switch themes:
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {DEMO_THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.name}
              aria-label={`Preview ${item.name} theme`}
              aria-pressed={item.id === activeTheme}
              onClick={() => {
                send({ colorTheme: item.id })
                setActiveTheme(item.id)
              }}
              className={cn(
                "size-4 rounded-full border border-border transition-transform hover:scale-125",
                item.id === activeTheme &&
                  "ring-2 ring-[var(--demo-accent)] ring-offset-2 ring-offset-background"
              )}
              style={{ backgroundColor: item.accent }}
            />
          ))}
        </div>
        <span className="font-display text-xs text-muted-foreground italic">
          {theme?.name}
        </span>
      </figcaption>
    </figure>
  )
}

function DEMOTHEMES_HAS(id: string): boolean {
  return DEMO_THEMES.some((item) => item.id === id)
}
