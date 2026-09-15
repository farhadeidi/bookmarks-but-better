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
  preview: {
    path: "/preview/",
    title: "Live preview — Bookmarks But Better",
    description:
      "Try the real Bookmarks But Better new tab in your browser: a live bookmarks dashboard with demo data. Drag, edit, search and switch themes.",
    name: "Live preview",
    summary: "the real app running in the browser against seeded demo data",
  },
  daemon: {
    path: "/daemon/",
    title: "Markdown vault & local daemon — Bookmarks But Better",
    description:
      "Keep bookmarks as plain Markdown files you own, served by a small daemon on 127.0.0.1 only. Usable in Obsidian and Git, with multiple vaults and Safari support.",
    name: "Markdown vault & daemon",
    summary:
      "what a Markdown vault is, how the local daemon serves it, install",
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
      "Guides to a private bookmarks new tab: moving from Pocket or Raindrop, keeping bookmarks as Markdown in Obsidian, using Safari, and more.",
    name: "Guides",
    summary: "index of guides",
  },
} as const satisfies Record<string, PageMeta>
