import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"
import { Hero } from "@/components/hero"
import { TrustStrip } from "@/components/trust-strip"
import { Features } from "@/components/features"
import { Sources } from "@/components/sources"
import { DaemonCta } from "@/components/daemon-cta"
import { ThemesGallery } from "@/components/themes-gallery"
import { PrivacyPledge } from "@/components/privacy-pledge"
import { Faq } from "@/components/faq"

export function Landing() {
  return (
    <>
      <SiteHeader />
      <main>
        <Hero />
        <TrustStrip />
        <Features />
        <Sources />
        <DaemonCta />
        <ThemesGallery />
        <PrivacyPledge />
        <Faq />
      </main>
      <SiteFooter />
    </>
  )
}
