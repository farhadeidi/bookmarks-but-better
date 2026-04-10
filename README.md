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
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=github">
    <img src="marketing/output/01-dashboard.png" width="700" alt="Dashboard in dark mode" />
  </a>
</p>

## Features

- **Masonry layout** — Bookmark folders displayed as cards in a responsive grid
- **Two view modes** — Switch between list and icon grid per folder
- **Inline editing** — Rename bookmarks, change URLs, edit folders — all inline
- **10 color themes** — Default, Amber, Bubblegum, Caffeine, Claude, Claymorphism, Cyberpunk, Solar Dusk, T3 Chat, Vintage Paper
- **Light & dark mode** — Follows system preference or toggle manually
- **Choose your root folder** — Display bookmarks from any folder
- **Import & export** — Standard HTML bookmark files
- **High-quality favicons** — Sharp icons on every display
- **Always in sync** — Changes saved directly to Chrome's bookmarks
- **100% private** — No analytics, no tracking, no data leaves your browser

## Install

<a href="https://chromewebstore.google.com/detail/nflojekghnganlcjncbepnnnkgakghif?utm_source=github"><img src="https://img.shields.io/badge/Install_from-Chrome_Web_Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Install from Chrome Web Store" /></a>

Or load manually:

1. Clone this repository
2. Run `bun install && bun run build`
3. Open `chrome://extensions`, enable **Developer mode**
4. Click **Load unpacked** and select the `dist/` folder

## Screenshots

<p align="center">
  <img src="marketing/output/03-themes.png" width="700" alt="5 color themes side by side" />
</p>

<p align="center">
  <img src="marketing/output/02-organizer.png" width="700" alt="Bookmark Organizer tree editor" />
</p>

<p align="center">
  <img src="marketing/output/04-settings.png" width="700" alt="Settings dialog" />
</p>

## Development

```bash
bun install        # Install dependencies
bun dev            # Start dev server (standalone mode)
bun run build      # Build for production → dist/
bun run typecheck  # Type check
bun lint           # Lint
bun run format     # Format code
```

## Feedback & Issues

Found a bug or have a feature request? [Open an issue](../../issues) — all feedback is welcome.

## License

MIT
