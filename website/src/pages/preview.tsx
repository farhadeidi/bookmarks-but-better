import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { AppPreview } from "@/components/app-preview"

export function Preview() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-6 py-12 md:py-16">
        <div className="text-center">
          <p className="font-display text-sm text-primary italic">
            Live preview
          </p>
          <h1 className="font-display mt-2 text-4xl font-medium tracking-tight text-balance md:text-5xl">
            The real thing, running right now
          </h1>
          <p className="mx-auto mt-5 max-w-xl leading-relaxed text-pretty text-muted-foreground">
            This is the actual extension — not a video — with a simulated
            bookmark library. Browse it, drag things, open settings, switch
            sources and themes. Your changes persist in this browser, exactly
            like the real new tab page.
          </p>
        </div>
        <div className="mt-10">
          <AppPreview tall />
        </div>
        <p className="mx-auto mt-6 max-w-xl text-center text-xs text-muted-foreground">
          The preview runs fully in your browser against seeded demo data and
          public favicon lookups for real site icons — no extension, no daemon,
          and no user bookmarks are involved.
        </p>
      </main>
      <SiteFooter />
    </>
  )
}
