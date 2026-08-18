import { useState } from "react"
import { cn } from "@/lib/cn"

export function CopyButton({
  text,
  label = "command",
  className,
}: {
  text: string
  label?: string
  className?: string
}) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)

  async function copy() {
    setFailed(false)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setFailed(true)
      window.setTimeout(() => setFailed(false), 2000)
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : failed ? "Copy failed" : `Copy ${label}`}
      className={cn(
        "relative inline-flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        className
      )}
    >
      {copied ? (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="2"
          className="size-4 shrink-0 stroke-current"
          aria-hidden
        >
          <path d="m20 6-11 11-5-5" />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="1.8"
          className="size-4 shrink-0 stroke-current"
          aria-hidden
        >
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )}
      <span
        className="absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2 pointer-fine:hidden"
        aria-hidden="true"
      />
    </button>
  )
}
