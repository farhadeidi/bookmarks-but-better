import { useState } from "react"
import { cn } from "@/lib/cn"

const SUN = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="1.8"
    className="size-4 stroke-current"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" />
  </svg>
)

const MOON = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="1.8"
    className="size-4 stroke-current"
  >
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
)

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(() =>
    typeof document === "undefined"
      ? false
      : document.documentElement.classList.contains("dark")
  )

  function toggle() {
    const next = !dark
    setDark(next)
    document.documentElement.classList.toggle("dark", next)
    try {
      localStorage.setItem("bbb-site-theme", next ? "dark" : "light")
    } catch {
      /* storage unavailable */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative inline-flex size-9 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className
      )}
    >
      {dark ? SUN : MOON}
      <span
        className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        aria-hidden="true"
      />
    </button>
  )
}
