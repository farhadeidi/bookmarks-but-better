<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo.svg">
    <source media="(prefers-color-scheme: light)" srcset="public/logo-dark.svg">
    <img src="public/logo-dark.svg" width="100" alt="Bookmarks But Better logo">
  </picture>
</p>

<h1 align="center">Bookmarks But Better</h1>

<p align="center">
  A clean, beautiful bookmarks dashboard that replaces your new tab page.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=github"><img src="https://img.shields.io/chrome-web-store/v/nflojekghnganlcjncbepnnnkgakghif?label=Chrome%20Web%20Store" alt="Chrome Web Store" /></a>
  <a href="https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=github"><img src="https://img.shields.io/amo/v/bookmarks-but-better?label=Firefox%20Add-ons" alt="Firefox Add-ons" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=github">
    <img src="marketing/output/01-dashboard.png" width="700" alt="Dashboard in dark mode" />
  </a>
</p>

## Features

- **Masonry layout** — Bookmark folders displayed as cards in a responsive grid
- **Bookmark Organizer** — Full tree editor to drag, reorder, rename, create, and delete bookmarks and folders
- **Two view modes** — Switch between list and icon grid per folder
- **Inline editing** — Rename bookmarks, change URLs, edit folders all inline
- **10 color themes** — Default, Amber, Bubblegum, Caffeine, Claude, Claymorphism, Cyberpunk, Solar Dusk, T3 Chat, Vintage Paper
- **Light and dark mode** — Follows system preference or toggle manually
- **Choose your root folder** — Display bookmarks from any folder
- **Import and export** — Standard HTML bookmark files
- **Smart favicons** — Sharp, high-quality site icons, cached locally so they load offline, with a clean letter fallback when a site has none
- **Quick capture** — Save the active tab from the extension popup
- **Address-bar search** — Search the active source with the `bb` omnibox keyword
- **Three bookmark sources** — Browser bookmarks, a browser-local standalone collection, or an optional Markdown vault daemon
- **Private by design** — No account, analytics, tracking, ads, or bookmark-content collection. Favicons are the one thing that leaves your machine; see [Privacy](#privacy)

Existing extension users upgrade in place. Version 4 preserves their selected
root folder, layouts, themes and completed setup state; the setup wizard is not
shown again unless they explicitly choose **Show setup wizard** in Settings.

## Install

<p>
  <a href="https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=github"><img src="https://img.shields.io/badge/Install_from-Chrome_Web_Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Install from Chrome Web Store" /></a>
  &nbsp;
  <a href="https://addons.mozilla.org/firefox/addon/bookmarks-but-better/?utm_source=github"><img src="https://img.shields.io/badge/Install_from-Firefox_Add--ons-FF7139?style=for-the-badge&logo=firefox&logoColor=white" alt="Install from Firefox Add-ons" /></a>
</p>

Or load manually:

**Chrome**

1. Clone this repository
2. Run `bun install && bun run build:chrome`
3. Open `chrome://extensions`, enable **Developer mode**
4. Click **Load unpacked** and select the `dist-chrome/` folder

**Firefox**

1. Clone this repository
2. Run `bun install && bun run build:firefox`
3. Open `about:debugging#/runtime/this-firefox`
4. Click **Load Temporary Add-on** and select any file inside `dist-firefox/`

### Daemon (optional)

The extension can also point at a local `bookmarks-but-better` daemon — a small
background process that serves your bookmarks from a folder of Markdown files
instead of the browser's own bookmark store, over `127.0.0.1`/`localhost` only.
This is entirely optional; browser and standalone modes need nothing from it.

```sh
# macOS / Linux
curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash
```

```powershell
# Windows (PowerShell)
irm https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1 | iex
```

```sh
# Any platform, if you already have Node.js
npx bookmarks-but-better@latest
```

All three install the same thing, from the same GitHub Release, checksum-verified.
See [docs/DAEMON.md](docs/DAEMON.md) for what the install scripts do, and how to
point the extension at the daemon.

The daemon binds to loopback only. Connecting from the extension requests
optional localhost access at that moment, not during extension installation.

## Screenshots

<p align="center">
  <img src="marketing/output/02-organizer.png" width="700" alt="Bookmark Organizer tree editor" />
</p>

<p align="center">
  <img src="marketing/output/03-themes.png" width="700" alt="10 color themes" />
</p>

<p align="center">
  <img src="marketing/output/04-settings.png" width="700" alt="Settings dialog" />
</p>

## Privacy

There is no account, no analytics, no tracking and no collection of bookmark
content. Your bookmarks stay in your browser profile, in your Markdown vault, or
both — nothing about them is uploaded anywhere.

The one exception is **favicons**, and it is worth being precise about it. Site
icons are not something a browser extension can generally produce on its own, so
they come from a short chain of providers, tried in order:

1. **The local cache.** Icon bytes stored in IndexedDB on this machine. A hit
   contacts nobody at all. Entries live 30 days; "nobody has an icon for this
   site" is remembered for a day.
2. **The browser's own icon database**, where it exists. On Chrome that is the
   `_favicon` API, which answers out of the browser's local store — this is the
   first thing Chrome tries, and a hit contacts nobody. Firefox exposes no
   equivalent an extension can read without the `tabs` permission, which this
   extension deliberately does not request, so it has no native step.
3. **Google's favicon service** (`t1.gstatic.com`, and `www.google.com/s2` in
   some builds). This is the step that discloses something: Google is sent the
   bookmark's **origin** — `https://example.com`, never the path, query or
   fragment. Over a whole dashboard, the set of origins asked about is
   effectively your list of bookmarked sites.
4. **A letter placeholder**, generated locally, when everything above misses.

So: an origin reaches Google only when the cache misses and no local source
answered. In the Chrome and Firefox extensions the response's bytes are stored
after the first successful lookup, so a given site is asked about roughly once a
month rather than on every render. The daemon's own web app, served over
loopback, is not allowed to read a cross-origin response, so it can display
Google's icon but not cache it — there, a site with an icon is still fetched from
Google on each load. Removing that last case needs the daemon to fetch icons
itself, which is tracked separately.

The daemon binds to `127.0.0.1`/`localhost` and makes no outbound request of its
own. Every request described above is made by the browser rendering the UI.

## Development

```bash
bun install               # Install dependencies
bun run dev               # Dev Workbench — the full app in a browser, with simulated scenarios
bun run build             # Build for both Chrome and Firefox
bun run build:chrome      # Build for Chrome only → dist-chrome/
bun run build:firefox     # Build for Firefox only → dist-firefox/
bun run zip:firefox       # Package Firefox build → bookmarks-but-better-firefox.zip
bun run typecheck         # Type check
bun run lint              # Lint
bun run format            # Format code
bun run test              # Run tests
bun run test:ui           # Playwright UI tests against the Dev Workbench (isolated dev server)
bun run test:npm          # Test the npx launcher in packages/bookmarks-but-better
```

`bun run dev` needs no extension and no daemon: it opens the complete
application against deterministic, URL-addressable scenarios (`?scenario=safari`,
`?scenario=daemon-offline`, …) with failure controls for offline, latency,
permission and mutation behavior. See
[docs/DEV_WORKBENCH.md](docs/DEV_WORKBENCH.md).

## Releasing

A tag ships everything, and nothing else does:

```bash
git push origin v4.1.0-beta.1   # GitHub prerelease with downloadable artifacts, no store
git push origin v4.1.0          # GitHub release, then store publishing after an approval
```

See [docs/RELEASING.md](docs/RELEASING.md) for the version checklist, the
`production-stores` approval flow, what a green Firefox submission actually
means, and how to re-run a failed store submission.

## Feedback and Issues

Found a bug or have a feature request? [Open an issue](../../issues) — all feedback is welcome.

## License

MIT
