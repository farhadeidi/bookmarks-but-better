import { cn } from "@/lib/cn"
import { SITE } from "@/lib/site"

export function InstallButtons({
  chromeLabel = "Add to Chrome",
  firefoxLabel = "Add to Firefox",
  className,
}: {
  chromeLabel?: string
  firefoxLabel?: string
  className?: string
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      <a
        href={SITE.chromeStore}
        className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="currentColor"
          aria-hidden
        >
          <path d="M12 2a10 10 0 0 1 9.5 6.9h-9.9a3.6 3.6 0 0 0-3.4 2.4L4.3 5.5A10 10 0 0 1 12 2ZM2.2 9.1l4.4 3.6a3.6 3.6 0 0 0 .8 3.9l-3.3 4A10 10 0 0 1 2 12c0-1 .1-2 .2-2.9ZM12 22a10 10 0 0 1-6.7-2.6l4-2.4a3.6 3.6 0 0 0 4.7-1.7h6A10 10 0 0 1 12 22Z" />
        </svg>
        {chromeLabel}
      </a>
      <a
        href={SITE.firefoxStore}
        className="inline-flex h-11 items-center gap-2 rounded-md border border-border bg-card px-5 text-sm font-medium text-card-foreground transition-colors hover:bg-muted"
      >
        <svg
          viewBox="0 0 24 24"
          className="size-4"
          fill="currentColor"
          aria-hidden
        >
          <path d="M21.3 6.9c-.5-1.2-1.5-2.5-2.3-2.9.6 1.1.9 2 1 2.7v.1c-1.2-2.9-3.2-4-4.8-6.4-.1-.1-.1-.2-.2-.4 0 0-.1-.1-.1-.2-.4 2.4-1.6 4.4-3.5 5.9-1.2.9-2.6 2.4-2.6 4.5v.2A4.6 4.6 0 0 1 9.4 7a4.7 4.7 0 0 0-1.5 3.6c0 1.1.3 2.1.9 3-1.7-.9-4.6-1.8-4.6-6.2C2.5 10 4 12.9 6.5 15c1.2 1 2.2 2.3 2.2 2.3s-.7-1-1-2.3c1.8 1.3 4.2 2.9 5.3 5.4-.3-2-1-4.1-2.1-5.8-.9-1.4-1.9-2.7-1.7-4.5.9 1.4 2 2.2 3.4 2.8 3.6 1.6 4.5 3.4 4.7 4.3.9-1.4.4-3.9-.3-5.2v-.1c.9.8 2 2.3 2.2 4.7.4-2.9-.7-5.8-2.2-7.6.8.4 1.8 1.3 2.4 2.3-.2-1.2-.7-2.5-1.6-3.6l.1.1c.8.7 1.8 1.8 2.2 2.9Z" />
        </svg>
        {firefoxLabel}
      </a>
    </div>
  )
}
