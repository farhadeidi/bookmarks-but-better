<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo.svg">
    <source media="(prefers-color-scheme: light)" srcset="public/logo-dark.svg">
    <img src="public/logo-dark.svg" width="100" alt="Bookmarks But Better logo">
  </picture>
</p>

<h1 align="center">Bookmarks - But Better</h1>

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
- **Smart favicons** — Sharp, high-quality site icons with a clean letter fallback when a site has none
- **Always in sync** — Changes saved directly to your browser bookmarks
- **100% private** — No analytics, no tracking, no data leaves your browser

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

The extension can also point at a local `bbb` daemon — a small background
process that serves your bookmarks from a folder of Markdown files instead of
the browser's own bookmark store, over `127.0.0.1`/`localhost` only. This is
entirely optional; browser and standalone modes need nothing described here.

Install it with:

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/farhadeidi/bookmarks-but-better/main/install.sh | sh

# Windows (PowerShell)
irm https://raw.githubusercontent.com/farhadeidi/bookmarks-but-better/main/install.ps1 | iex
```

Both scripts install to a user-local directory (no administrator/`sudo`
prompt), verify the downloaded release against its published SHA-256
checksum before installing anything, and finish by running `bbb setup` to
create a vault. Pass `--beta` (`-Beta` on Windows) to install the latest
prerelease instead of the latest stable release, or `--version vX.Y.Z` to pin
an exact one. See [crates/bbb/README.md](crates/bbb/README.md) for the daemon
itself — the HTTP API, the background-service integration for each OS, and
what `bbb service install` does.

Once it's running, open the extension's Settings → **Bookmark Source** →
**Daemon**, enter the daemon's address (`127.0.0.1:52222` by default) and
click **Connect**. The extension only requests permission to reach loopback
addresses at that point — never at install time — and only switches to the
daemon if a real health check against it succeeds; a daemon that can't be
reached is reported as an error, never a silent fall back to your browser
bookmarks.

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

## Development

```bash
bun install               # Install dependencies
bun run dev               # Start dev server (standalone mode)
bun run build             # Build for both Chrome and Firefox
bun run build:chrome      # Build for Chrome only → dist-chrome/
bun run build:firefox     # Build for Firefox only → dist-firefox/
bun run zip:firefox       # Package Firefox build → bookmarks-but-better-firefox.zip
bun run typecheck         # Type check
bun run lint              # Lint
bun run format            # Format code
bun run test              # Run tests
```

## Releasing

A tag ships everything, and nothing else does:

```bash
git push origin v4.0.0-beta.1   # GitHub prerelease with downloadable artifacts, no store
git push origin v4.0.0          # GitHub release, then store publishing after an approval
```

See [docs/RELEASING.md](docs/RELEASING.md) for the version checklist, the
`production-stores` approval flow, what a green Firefox submission actually
means, and how to re-run a failed store submission.

## Feedback and Issues

Found a bug or have a feature request? [Open an issue](../../issues) — all feedback is welcome.

## License

MIT
