import { InstallButtons } from "@/components/install-buttons"
import { AppPreview } from "@/components/app-preview"
import { SITE } from "@/lib/site"

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-linear-to-b from-primary/8 to-transparent"
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 text-center md:pt-28 md:pb-24">
        <p className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-sm text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" aria-hidden />
          Free &amp; open source — Chrome · Firefox · Safari via daemon
        </p>
        <h1 className="font-display mx-auto mt-8 max-w-[20ch] text-6xl font-medium tracking-tight md:text-8xl">
          Bookmarks,
          <br />
          <span className="italic">but better</span>
        </h1>
        <p className="mx-auto mt-8 max-w-[52ch] text-pretty text-muted-foreground md:text-lg">
          A clean, private dashboard replaces your new tab page. No account, no
          tracking, nothing to sign up for.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <InstallButtons />
          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
            <a
              href="/preview/"
              className="text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
            >
              Try the live full-screen preview
            </a>
            <span className="hidden text-border sm:inline" aria-hidden>
              ·
            </span>
            <a
              href={SITE.repository}
              className="text-muted-foreground underline decoration-border underline-offset-4 hover:text-foreground"
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
