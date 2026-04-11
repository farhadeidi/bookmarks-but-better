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
- **High-quality favicons** — Sharp icons on every display
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

## Feedback and Issues

Found a bug or have a feature request? [Open an issue](../../issues) — all feedback is welcome.

## License

MIT
