# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.0.0] - 2026-08-11

### Added

- **Local-first daemon (`bookmarks-but-better`)** — a Rust daemon, HTTP API and
  CLI that serves a Markdown vault and, optionally, the web UI over loopback
  only. Release archives cover Linux (x86_64 and aarch64), macOS (Intel and
  Apple Silicon), and Windows (x86_64), each with a SHA-256 checksum
- `bookmarks-but-better init`, `doctor`, `rescan`, `setup`, `serve` and
  user-level service-management commands
- Canonical Markdown vault format with deterministic scanning, byte-preserving
  updates, stable identities, optimistic revisions and crash-safe recovery
- Daemon-managed manual child ordering, so the organizer's drag-and-drop order
  persists in the vault
- A daemon build target for the web UI (`bun run build:daemon`), served by the
  daemon from `--ui-dir`
- **Capture pages directly from Chrome and Firefox into a daemon vault** from a
  compact extension popup, without importing the browser bookmark store
- **Search daemon bookmarks from the address bar** with the
  `bookmarks-but-better` omnibox keyword and deterministic title/URL ranking
- **`npx bookmarks-but-better@latest` installs the daemon** through the same
  checksum-verified release installers as the shell and PowerShell entry points
- Release assets now include `install.sh` and `install.ps1`, their checksums,
  both extension packages and five platform-specific daemon archives
- Stable store publishing is gated by the manually approved
  `production-stores` environment; beta tags never contact either store

### Fixed

- Existing v2/v3 users retain their completed setup state during upgrade, and
  changing between Browser, Standalone and Daemon never reopens onboarding
- Daemon mode now shows real site favicons instead of generated placeholders
- Installers now fall back explicitly when a selected historical stable release
  has no daemon archive, and piped shell installs correctly attach interactive
  setup to the terminal

### Changed

- Everything shipped by the project now uses the `bookmarks-but-better` name.
  This only breaks pre-release daemon installations; released extension IDs and
  user storage remain unchanged
- The daemon's default port is now `52222`. An installation explicitly
  configured on the previous `47321` default keeps that port
- The npm launcher has an independent version lifecycle and ships no binaries
- Installers resolve releases without `jq` or the GitHub JSON API
- Daemon mode fetches favicons from Google's public favicon services. The primary
  provider (`t1.gstatic.com/faviconV2`) is the one every build already uses; the
  fallback is standalone's (`www.google.com/s2/favicons`), not the extension
  builds' — Chrome falls back to its own on-device `_favicon` API and Firefox has
  no fallback at all. This is a deliberate privacy trade-off: rendering a bookmark
  sends its origin (never its path) to Google, where daemon mode previously
  disclosed nothing. The daemon process itself is unchanged — it still binds
  loopback only and makes no outbound request; the requests come from the browser
  showing the UI. See `crates/bookmarks-but-better/README.md` for the full note.

## [3.2.1] - 2026-08-02

### Fixed

- Prevented a brief white flash when opening a new tab in dark mode by applying the selected theme before the first browser paint

## [3.2.0] - 2026-06-05

### Added

- Firefox support: a dedicated Firefox build with an AMO-compliant manifest and Firefox for Android (Gecko) support
- Option to set the dashboard as your Firefox Homepage, in addition to the new tab page
- Dual-build pipeline with separate `build:chrome` and `build:firefox` output directories

### Changed

- Preferences are now stored locally per device instead of syncing across devices; existing settings are migrated automatically on first launch

### Fixed

- Root folder selection no longer breaks when switching between operating systems — the previously synced bookmark folder ID did not match across profiles/OSes
- Replaced Google's default globe favicon with a clean letter fallback

## [3.1.0] - 2026-04-05

### Added

- Bookmark Organizer: new full-featured tree editor accessible from the footer toolbar and folder card menu
- Drag-and-drop reordering within the organizer tree with live drop-line indicator and item dimming
- Per-folder create actions: add a subfolder or bookmark directly inside any folder from the tree
- Expand All / Collapse All controls in the organizer toolbar
- Folders Only toggle to hide bookmark items and focus on folder structure (persisted across sessions)
- New Bookmark option added to folder card context menu
- FAB toolbar now has a frosted background to remain legible when overlapping content

### Changed

- Folder order entry points replaced by the Bookmark Organizer sheet
- Bookmark Organizer tree auto-expands top-level folders on open
- New Folder button removed from footer toolbar (use Bookmark Organizer instead)
- Folder card context menu widened to fit all action labels on one line

## [3.0.0] - 2026-03-29

### Added

- Drag-and-drop bookmark sorting with support for reordering within and across folders
- Folder order dialog for rearranging folder tabs via drag-and-drop
- Create folder button for quick folder management
- Custom scrollbar styling using ScrollArea component
- Email clients added to default seed bookmarks
- `clipboardWrite` permission for copy-to-clipboard functionality

### Changed

- Updated grid view default column layout
- Improved performance: memoized components, lazy-loaded dialogs, eliminated double-refresh on startup

### Fixed

- Bookmark links no longer open in a new tab unexpectedly
- Same-folder drag reorder offset in Chrome adapter
- Drop indicator duplication in grid layout
- Native drag interference on links and images inside bookmark cards

### Removed

- Unused dependencies cleaned up

## [2.1.0] - 2026-03-26

### Added

- Folder actions: rename, delete, and reorder folders
- Layout settings for customizing bookmark grid columns
- GitHub issue templates for bug reports and feature requests

## [2.0.0] - 2026-03-24

### Added

- First-run onboarding wizard with welcome, root folder selection, appearance, and done steps
- Theme grid with mode toggle in onboarding
- Curated seed bookmarks for new users
- Bookmark logo and comprehensive icon set
- "Show in bookmark manager" action on bookmark cards
- Google Favicon V2 for higher quality site icons
- Chrome Web Store listing and promotional assets
- MIT License

### Fixed

- Favicon rendering on HiDPI displays (64px request)
- Wizard step edge bleed during slide animations
- Folder label shown instead of ID in select trigger
- Host permissions for Google favicon services

### Changed

- Rewrote README for end users with screenshots and badges

[4.0.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v3.2.1...v4.0.0
[3.2.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/farhadeidi/bookmarks-but-better/releases/tag/v2.0.0
