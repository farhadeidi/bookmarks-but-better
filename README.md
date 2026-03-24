<p align="center">
  <img src="public/logo-dark.svg" width="100" alt="Bookmarks But Better logo" />
</p>

<h1 align="center">Bookmarks - But Better</h1>

<p align="center">
  A clean, beautiful bookmarks dashboard that replaces your new tab page.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" />
</p>

---

## What is this?

A Chrome extension that turns your new tab page into an organized, Pinterest-style bookmarks dashboard. No more digging through menus - your bookmarks are front and center, every time you open a new tab.

## Features

- **Masonry layout** - Your bookmark folders displayed as cards in a clean, responsive grid
- **Two view modes** - Switch between list and icon grid on each folder
- **Edit everything** - Rename bookmarks, change URLs, edit folders - all inline
- **10 color themes** - Default, Amber, Bubblegum, Caffeine, Claude, Claymorphism, Cyberpunk, Solar Dusk, T3 Chat, Vintage Paper
- **Light & dark mode** - Follows your system preference, or press `D` to toggle
- **Choose your root folder** - Display bookmarks from any folder you want
- **Import & export** - Bring bookmarks in or take them out as standard HTML files
- **High-quality favicons** - Sharp icons for every bookmark, even on HiDPI displays
- **Always in sync** - Changes you make are saved directly to Chrome's bookmarks

## Install

1. Download or clone this repository
2. Open `chrome://extensions` in your browser
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the `dist/` folder
5. Open a new tab - that's it!

> **Chrome Web Store:** [Install from the Chrome Web Store](link-pending)

## How to Use

- **Browse** - Scroll through your bookmark folders displayed as cards
- **Open** - Click any bookmark to open it
- **Edit** - Right-click or use the hover menu to edit, copy, or delete bookmarks
- **Customize** - Use the buttons in the bottom-right corner to change theme, color, and settings
- **Pick a root folder** - Open settings and choose which folder to display as your starting point

## Screenshots

<p align="center">
  <img src="docs/screenshots/dashboard-dark.png" width="700" alt="Dashboard in dark mode" />
</p>

<p align="center">
  <img src="docs/screenshots/dashboard-theme.png" width="700" alt="Dashboard with alternate theme" />
</p>

<p align="center">
  <img src="docs/screenshots/hover-card.png" width="700" alt="Bookmark hover card" />
</p>

<p align="center">
  <img src="docs/screenshots/onboarding.png" width="700" alt="First-run onboarding wizard" />
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

Found a bug or have a feature request? [Open an issue](../../issues) - all feedback is welcome.

## License

MIT
