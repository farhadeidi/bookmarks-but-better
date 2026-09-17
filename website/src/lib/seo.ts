import type { FaqItem } from "./faq-items"
import { SITE } from "./site"

export type JsonLd = Record<string, unknown>

/** JSON for a `<script type="application/ld+json">`, safe to inline in HTML. */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, "\\u003c")
}

/**
 * Stable node ids, so the blocks across the site read as one graph rather than
 * unconnected objects: a docs page's `isPartOf` and `about` point at the
 * `WebSite` and `SoftwareApplication` nodes the home page defines.
 */
const ID = {
  website: `${SITE.url}/#website`,
  app: `${SITE.url}/#app`,
  person: `${SITE.url}/#person`,
} as const

const AUTHOR = {
  "@type": "Person",
  "@id": ID.person,
  name: SITE.author,
  url: "https://github.com/farhadeidi",
}

/**
 * What the landing page claims, in the same terms. Structured data may only
 * describe what a reader of the page can see, so this list follows the page
 * rather than leading it.
 */
const FEATURES = [
  "Replaces the new-tab page with a dashboard where every bookmark folder is a card",
  "Drag-and-drop organizer: move, reorder, rename, create and delete bookmarks and folders",
  "Search palette: find a bookmark in the active source by title or URL",
  "Imports a bookmarks HTML file from any browser, and CSV exports from Raindrop and Pocket; exports to HTML",
  "Quick capture: save the page you are on from the toolbar popup",
  "Address-bar keyword search in Chrome and Firefox",
  "Bookmark sources: your browser's own bookmarks, or Markdown vaults served by a local daemon",
  "Ten themes, each in light, dark and system mode",
  "No account, analytics, tracking or bookmark-content collection",
]

/**
 * The product entity. The caller passes the hero's dashboard capture as the
 * page actually serves it: only the page can resolve the built image URL, and
 * a `screenshot` has to be an image the reader of this page can see.
 */
export function softwareApplication(screenshot: string): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": ID.app,
    name: SITE.name,
    url: `${SITE.url}/`,
    description: SITE.tagline,
    applicationCategory: "BrowserApplication",
    // No `operatingSystem`: Chrome and Firefox are browsers, not operating
    // systems, and the extension runs wherever they do — Firefox for Android
    // included (`gecko_android` in manifest.firefox.json). Naming three desktop
    // systems would be both unsupported by this page and short of the truth.
    // Which browsers it runs in is in `featureList` and on the page.
    softwareVersion: SITE.version,
    isAccessibleForFree: true,
    // The documented way to say "free". There is no `aggregateRating` or
    // `review` here because the project has none, so this will not produce a
    // rich result — it is here for entity clarity.
    offers: { "@type": "Offer", price: 0, priceCurrency: "USD" },
    license: SITE.license,
    featureList: FEATURES,
    // `installUrl` alone: these are store listings, and schema.org's
    // `downloadUrl` means a URL that yields a downloadable binary.
    installUrl: [SITE.chromeStoreUrl, SITE.firefoxStoreUrl],
    releaseNotes: SITE.releases,
    softwareHelp: { "@type": "CreativeWork", url: `${SITE.url}/docs/` },
    screenshot,
    sameAs: [SITE.repository],
    author: AUTHOR,
    maintainer: { "@id": ID.person },
  }
}

/**
 * The site itself. Google reads this from the home page, and nowhere else, to
 * choose the site name it shows in results. No `potentialAction`: the sitelinks
 * search box was retired in 2024 and the markup is ignored.
 */
export function website(): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": ID.website,
    name: SITE.name,
    url: `${SITE.url}/`,
    description: SITE.tagline,
    inLanguage: "en",
    publisher: AUTHOR,
  }
}

export interface ArticleOptions {
  /** `TechArticle` for documentation, `Article` for a site page. */
  type: "TechArticle" | "Article"
  headline: string
  description?: string
  /** The page's canonical URL. */
  url: string
  /** The commit that last touched the page's source, from git. */
  dateModified?: Date
}

/**
 * One documentation page or site article. `dateModified` is only present where
 * git history supplies it; there is still no `datePublished`, because the first
 * commit that added a file is a poor stand-in for when the page went live.
 */
export function article({
  type,
  headline,
  description,
  url,
  dateModified,
}: ArticleOptions): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": type,
    headline,
    ...(description ? { description } : {}),
    url,
    inLanguage: "en",
    ...(dateModified
      ? { dateModified: dateModified.toISOString().slice(0, 10) }
      : {}),
    isPartOf: { "@id": ID.website },
    about: {
      "@type": "SoftwareApplication",
      "@id": ID.app,
      name: SITE.name,
      url: `${SITE.url}/`,
    },
    author: AUTHOR,
    publisher: { "@id": ID.person },
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

/**
 * The trail above a documentation page. Only sections that are real pages
 * appear, so every entry resolves: /docs/start/ has no index page of its own
 * and is left out rather than linked into nothing.
 */
export function breadcrumbs(trail: { name: string; path: string }[]): JsonLd {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map(({ name, path }, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name,
      item: new URL(path, SITE.url).href,
    })),
  }
}
