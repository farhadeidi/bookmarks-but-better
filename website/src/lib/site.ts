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
  ogImageAlt: "Bookmarks But Better dashboard in dark mode",
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
  daemonDocs: "/docs/daemon/install/",
  installSh: `${REPOSITORY}/releases/latest/download/install.sh`,
  installPs1: `${REPOSITORY}/releases/latest/download/install.ps1`,
} as const

/** Browser UI colors for the paper (light) and lamplight (dark) palettes. */
export const THEME_COLORS = { light: "#faf9f5", dark: "#1b1a17" } as const

export const DAEMON_COMMANDS = [
  {
    label: "Any platform with Node.js",
    code: "npx bookmarks-but-better@latest",
  },
  {
    label: "macOS / Linux, without Node.js",
    code: `curl -fsSL ${SITE.installSh} | bash -s -- --vault ~/Bookmarks`,
  },
  {
    label: "Windows (PowerShell), without Node.js",
    code: `& ([scriptblock]::Create((irm ${SITE.installPs1}))) -Vault "$env:USERPROFILE\\Bookmarks"`,
  },
] as const
