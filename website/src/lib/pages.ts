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
    title: "Bookmarks But Better — A bookmark manager on your new tab",
    description:
      "A free bookmark manager that replaces your new tab with the bookmarks you already have. No account, nothing to set up, and optionally stored as Markdown you own.",
    name: "Home",
    summary: "product overview, features and installation links",
  },
  /**
   * The site header, a strip of theme dots, and the real app filling the rest
   * of the viewport in a frame. The app itself is a separate Vite build served
   * at /preview/app/ (app-frame/), embedded here and nowhere else.
   */
  preview: {
    path: "/preview/",
    title: "Live preview — Bookmarks But Better",
    description:
      "Try the real Bookmarks But Better new tab in your browser: a live bookmarks dashboard with demo data and all ten themes.",
    name: "Live preview",
    summary: "the real app running on seeded demo data, with every theme",
  },
  privacy: {
    path: "/privacy/",
    title: "Privacy — Bookmarks But Better",
    description:
      "No account, analytics, tracking or bookmark-content collection. Where your bookmarks live and the only network requests the extension makes, in plain language.",
    name: "Privacy",
    summary: "data location, network requests and permissions",
  },
} as const satisfies Record<string, PageMeta>
