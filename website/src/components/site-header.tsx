import { cn } from "@/lib/cn"
import { SITE } from "@/lib/site"
import { ThemeToggle } from "@/components/theme-toggle"

const NAV = [
  { href: "/#features", label: "Features" },
  { href: "/#themes", label: "Themes" },
  { href: "/preview/", label: "Live preview" },
  { href: "/daemon/", label: "Daemon" },
  { href: "/privacy/", label: "Privacy" },
]

export function SiteHeader({ className }: { className?: string }) {
  return (
    <header
      className={cn(
        "sticky top-0 z-50 border-b border-border bg-background/85 backdrop-blur",
        className
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-6">
        <a href="/" className="flex items-center gap-2.5">
          <img src="/logo-dark.svg" alt="" className="h-6 w-6 dark:hidden" />
          <img src="/logo.svg" alt="" className="hidden h-6 w-6 dark:block" />
          <span className="font-display text-lg font-semibold tracking-tight">
            Bookmarks But Better
          </span>
        </a>

        <nav
          className="ml-auto hidden items-center gap-6 md:flex"
          aria-label="Main"
        >
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <a
            href={SITE.repository}
            className="hidden size-9 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex"
            aria-label="GitHub repository"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" className="size-4">
              <path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55v-2.17c-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.69 5.38-5.25 5.67.41.35.77 1.05.77 2.12v3.15c0 .3.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
            </svg>
          </a>
          <ThemeToggle />
          <a
            href={SITE.chromeStore}
            className="inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Install
          </a>
        </div>
      </div>

      <details className="group border-t border-border md:hidden">
        <summary className="mx-auto flex max-w-6xl cursor-pointer list-none items-center justify-between px-6 py-2.5 text-sm text-muted-foreground">
          Menu
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="size-4 transition-transform group-open:rotate-180"
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </summary>
        <nav
          className="mx-auto grid max-w-6xl gap-1 px-6 pb-4"
          aria-label="Mobile"
        >
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="rounded-md px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </details>
    </header>
  )
}
