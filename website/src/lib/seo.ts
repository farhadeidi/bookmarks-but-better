import type { FaqItem } from "./faq-items"
import { SITE } from "./site"

export type JsonLd = Record<string, unknown>

/** JSON for a `<script type="application/ld+json">`, safe to inline in HTML. */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}

const AUTHOR = {
  "@type": "Person",
  name: SITE.author,
  url: "https://github.com/farhadeidi",
}

export function softwareApplication(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE.name,
    url: `${SITE.url}/`,
    description: SITE.tagline,
    applicationCategory: "BrowserApplication",
    operatingSystem: "Chrome, Firefox, Safari (with the local daemon)",
    softwareVersion: SITE.version,
    isAccessibleForFree: true,
    license: SITE.license,
    downloadUrl: [SITE.chromeStoreUrl, SITE.firefoxStoreUrl],
    screenshot: SITE.ogImage,
    sameAs: [SITE.repository],
    author: AUTHOR,
  }
}

export function faqPage(items: FaqItem[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: { "@type": "Answer", text: item.answer },
    })),
  }
}

export function article(input: {
  title: string
  description: string
  url: string
  publishedAt: Date
  updatedAt?: Date
}): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    url: input.url,
    mainEntityOfPage: input.url,
    image: SITE.ogImage,
    datePublished: input.publishedAt.toISOString(),
    dateModified: (input.updatedAt ?? input.publishedAt).toISOString(),
    author: AUTHOR,
    publisher: AUTHOR,
  }
}

/** `items` run from the site root to the current page; paths are site-relative. */
export function breadcrumbs(items: { name: string; path: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: new URL(item.path, SITE.url).href,
    })),
  }
}
