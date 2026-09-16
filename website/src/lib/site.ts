import pkg from "../../../package.json"

const REPOSITORY = "https://github.com/farhadeidi/bookmarks-but-better"
const CHROME_STORE =
  "https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif"
const FIREFOX_STORE =
  "https://addons.mozilla.org/firefox/addon/bookmarks-but-better/"

export const SITE = {
  name: "Bookmarks But Better",
  url: "https://bookmarks.but-better.dev",
  version: pkg.version,
  author: "Farhad Eidi",
  tagline:
    "Your bookmarks as a beautiful new tab. Local, private, no account. Optionally stored as Markdown you own.",
  ogImage: "https://bookmarks.but-better.dev/og.png",
  ogImageAlt:
    "Bookmarks, but better: a new tab extension for Chrome and Firefox, beside its bookmarks dashboard in dark mode",
  /** Canonical store listings, for structured data. */
  chromeStoreUrl: CHROME_STORE,
  firefoxStoreUrl: FIREFOX_STORE,
  /** Store links as the site's buttons use them. */
  chromeStore: `${CHROME_STORE}?utm_source=website`,
  firefoxStore: `${FIREFOX_STORE}?utm_source=website`,
  repository: REPOSITORY,
  issues: `${REPOSITORY}/issues`,
  releases: `${REPOSITORY}/releases`,
  license: `${REPOSITORY}/blob/main/LICENSE`,
} as const

/** Browser UI colors: the light and dark page backgrounds (global.css). */
export const THEME_COLORS = { light: "#fcfcfa", dark: "#121210" } as const
