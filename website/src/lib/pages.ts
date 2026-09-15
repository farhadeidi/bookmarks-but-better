/**
 * Metadata for the site's hand-built pages. The pages render their <head> from
 * it and llms.txt lists it, so a title or description lives in one place.
 */
export interface PageMeta {
  path: string
  /** The full document title. */
  title: string
  /** Meta description, at most 160 characters. */
  description: string
  /** Link text in llms.txt. */
  name: string
  /** One-line summary in llms.txt. */
  summary: string
}

export const PAGES = {
  home: {
    path: "/",
    title: "Bookmarks But Better — Your bookmarks as a beautiful new tab",
    description:
      "Your bookmarks as a beautiful new tab page. A local, private bookmarks dashboard with no account, optionally stored as Markdown you own. Free and open source.",
    name: "Home",
    summary: "product overview, features and installation links",
  },
  /** The live app itself (built from app-frame/), not an Astro page. */
  preview: {
    path: "/preview/",
    title: "Live preview — Bookmarks But Better",
    description:
      "Try the real Bookmarks But Better new tab in your browser: a live bookmarks dashboard with demo data.",
    name: "Live preview",
    summary: "the real app, full screen, running against seeded demo data",
  },
  privacy: {
    path: "/privacy/",
    title: "Privacy — Bookmarks But Better",
    description:
      "No account, analytics, tracking or bookmark-content collection. Where your bookmarks live and the only network requests the extension makes, in plain language.",
    name: "Privacy",
    summary: "data location, network requests and permissions",
  },
  guides: {
    path: "/guides/",
    title: "Guides — Bookmarks But Better",
    description:
      "Articles for choosing a private bookmark manager: moving from Pocket or Raindrop, keeping bookmarks as Markdown in Obsidian, and going without an account.",
    name: "Guides",
    summary: "articles on choosing and switching bookmark managers",
  },
} as const satisfies Record<string, PageMeta>
