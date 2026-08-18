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
          <h1 className="font-display mx-auto mt-2 max-w-[30ch] text-4xl font-medium tracking-tight text-balance md:text-5xl">
            The real thing, running right now
          </h1>
          <p className="mx-auto mt-5 max-w-[52ch] text-base/7 text-pretty text-muted-foreground sm:text-lg/8">
            This is the actual extension — not a video — with a simulated
            bookmark library. Browse it, drag things, open settings, switch
            sources and themes. Your changes persist in this browser, exactly
            like the real new tab page.
          </p>
        </div>
        <div className="mt-10">
          <AppPreview tall />
        </div>
        <p className="mx-auto mt-6 max-w-[52ch] text-center text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
          The preview runs fully in your browser against seeded demo data and
          public favicon lookups for real site icons — no extension, no daemon,
          and no user bookmarks are involved.
        </p>
      </main>
      <SiteFooter />
    </>
  )
}
