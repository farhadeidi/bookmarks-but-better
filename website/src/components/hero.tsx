import { InstallButtons } from "@/components/install-buttons"
import { AppPreview } from "@/components/app-preview"
import { SITE } from "@/lib/site"

const RIBBON = (
  <svg
    viewBox="0 0 16 24"
    className="inline-block h-[0.62em] w-auto text-primary"
    fill="currentColor"
    aria-hidden
  >
    <path d="M1 1a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v22l-7-5.4L1 23V1Z" />
  </svg>
)

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/8 to-transparent"
        aria-hidden
      />
      <div className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center md:pt-28 md:pb-24">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Free &amp; open source — Chrome · Firefox · Safari via daemon
        </p>
        <h1 className="font-display mx-auto mt-5 max-w-3xl text-5xl leading-[1.05] font-medium tracking-tight text-balance md:text-7xl">
          Bookmarks, but better
          {RIBBON}
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base text-pretty text-muted-foreground md:text-lg">
          A clean, private dashboard replaces your new tab page. Folders become
          cards, everything is editable inline — and there is no account, no
          tracking, nothing to sign up for.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <InstallButtons />
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
            <a
              href="/preview/"
              className="text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
            >
              Try the live full-screen preview
            </a>
            <span className="hidden text-border sm:inline" aria-hidden>
              ·
            </span>
            <a
              href={SITE.repository}
              className="text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground"
            >
              Build it from source on GitHub
            </a>
          </div>
        </div>
        <div className="mt-14 md:mt-20">
          <AppPreview />
        </div>
      </div>
    </section>
  )
}
