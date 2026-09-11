# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.1.1] - 2026-09-11

### Fixed

- **Grid icons are sharp again on Chrome.** Since the favicon cache landed,
  Chrome asked its own `_favicon` API before Google, and the grid went blocky:
  desktop Chrome keeps a site's icon at 16 and 32 pixels only and blows those
  up to fill a 64-pixel request, and the result was cached for 30 days. The
  provider order now depends on where the icon is drawn. A list row keeps
  asking the browser first, which contacts nobody; a grid tile asks Google
  first, which returns a site's larger icons at their real size, and falls
  back to the browser's store only when Google has nothing. The cache
  remembers which of the two an icon can serve, so a blocky icon already
  stored for a row is replaced the first time a tile needs it, and nothing
  has to be cleared.

## [4.1.0] - 2026-09-11

### Added

- **`npx bookmarks-but-better` looks after the daemon.** The npm package was
  a launcher that fetched the installer and ran it; it is now the Daemon
  Manager: `status` says what is installed, configured, running and connected
  and names the one command that fixes anything that is not; `install` installs
  or updates the daemon, asks the one question a first run has (where your
  bookmarks live), and installs and starts the background service; `uninstall`
  removes the service and the daemon and never a vault; `vault add|remove|list`
  edit the Vault Registry and restart the service so the running daemon
  matches it. Run with no command it installs when nothing is installed, and
  otherwise shows the status and a menu of what can be done about it; every
  command asks for what it was not given, so nothing has to be typed, and
  `--yes` answers with the defaults for scripts. It reads no bookmarks, has a
  version of its own, and by default installs the daemon release it was
  published for so the two never drift apart. The daemon's
  `/health` now carries `clients`, the number of open event streams, which is
  how `status` knows whether a browser is connected. See
  [ADR-0006](docs/adr/0006-manage-the-daemon-from-an-npm-tool-and-keep-management-out-of-its-api.md)

- **A Vault Registry, and the `vault` commands that manage it.** Multiple
  vaults per daemon existed only as `--vault ID=PATH` typed out on every
  `serve`, and `service install` took one vault and no ids at all — so the
  feature had no background-service story and nothing on the machine recorded
  which vaults existed. `bookmarks-but-better vault add|remove|rename|list|path`
  now keeps that set in one file, `serve --from-config` and
  `service install --from-config` read it, and `doctor` and `rescan` accept a
  configured id in place of a path. `vault list` says what is configured and,
  per vault, what is true of its directory right now — including `served now`
  when a daemon holds it, which is where the difference between configured and
  hosted becomes visible. `vault list --json` is the machine-readable form.

  This narrows the rule that no command may touch a directory the user did not
  name on that command line, and keeps what mattered about it: `vault add` is
  the only thing that writes the file, `vault list` is the audit, and a command
  that does not say `--from-config` still cannot reach a vault the command line
  did not name. `vault remove` takes an entry out of the file and never touches
  the directory. Adding or removing a vault still takes a daemon restart. See
  [ADR-0005](docs/adr/0005-record-configured-vaults-in-one-explicitly-written-file.md)

- **The background service can host several vaults.**
  `service install --vault ID=PATH` is repeatable, and `--from-config` installs
  what the registry holds. A definition serving exactly one vault under the id
  `default` still spells it as a bare `--vault PATH`, so an installation made
  before vaults had ids compares equal on upgrade and is not rewritten

- **Safari, built from the repository.** An Xcode project and a one-command
  ad-hoc build produce a signed macOS app carrying the extension, with no Apple
  Developer account needed to run it locally. Safari has no bookmarks API, so
  the build is daemon-only by capability rather than by branching on the browser
  name, and its setup wizard says so instead of offering a choice that does not
  exist. An end-to-end test drives the shipped bundle against a real daemon

- **The dashboard is operable from the keyboard.** The bookmark grid is a
  single tab stop: arrow keys move through it in the order you see rather than
  the order it is built in, Home and End reach a column's ends, Enter opens the
  focused bookmark, and Alt with an arrow moves one inside its folder — only
  where the source can express an order
- **Search palette** — start typing anywhere on the dashboard and a palette
  opens on the first character, matching bookmark titles and URLs and folder
  names across the whole Active Source. There is no shortcut to learn, and a
  Search action in the toolbar covers pointer and touch. Results carry their
  folder path, and any result can be revealed in the Bookmark Organizer —
  including one outside the dashboard's root folder, which widens the
  organizer for that visit without changing the saved root

- **Source Configuration** — enabled sources plus one Active Source per browser
  profile, persisted locally and never synced. Browser Sources and Daemon
  Sources stay separate collections; there is no merged view and no implicit
  move between sources
- **Live source switching** — an explicit Source Session transition that
  disposes the previous session's listeners and change stream, expires stale
  in-flight work, closes node-bound UI and re-initializes the dashboard
  without a reload. An unreachable daemon stays selected with recovery
  controls; there is never a silent fallback to browser bookmarks
- **A compact source switcher** above the bookmarks — tab-style with several
  enabled sources, and nothing at all with one, since there is nothing to
  switch to. The capture popup labels its
  destination and offers a quick change; the omnibox follows the same Active
  Source
- **Multiple Vaults per daemon** — repeatable `--vault ID=PATH`, atomic
  startup, duplicate-id and overlapping-root rejection, `GET /api/v1/vaults`
  discovery and vault-scoped routes under `/api/v1/vaults/{id}/…`. Legacy
  unscoped routes answer a stable `vault_required` error when more than one
  Vault is hosted, and the daemon-served web app switches among Vaults
  client-side. Client preferences are namespaced per Vault
- **Safari support (daemon-only)** — a Safari Web Extension build
  (`bun run build:safari`) whose manifest omits the bookmarks API, omnibox and
  new-tab override Safari does not provide; product code branches on
  capabilities, not browser names
- **Categorized settings** — General, Sources, Appearance, Data & Migration,
  Advanced and About, as vertical tabs on wide screens and a compact selector
  on narrow ones. Browser-specific bookmark options live inside the Browser
  Source section rather than appearing for Daemon Sources
- **Profile-local source labels and Vault controls** — rename source labels,
  refresh a daemon's Vault list, enable sources independently, and forget a
  connection without conflating those actions
- **Dev Workbench** — `bun run dev` opens the complete application in a plain
  browser, no extension and no daemon required, against deterministic
  URL-addressable scenarios (`browser-daemon` by default, plus
  `fresh-chrome`, `browser-only`, `multi-vault`, `daemon-offline`,
  `slow-daemon`, `legacy-standalone`, `safari`, `empty`, `large-library`)
  with scenario persistence, a deterministic Reset, and failure controls for
  offline, latency, permission, discovery, mutation and stale-revision
  behavior. The environment-specific source mechanics moved behind a
  SourceEnvironment seam; the workbench and its simulated sources are
  eliminated from every production build. `bun run test:ui` covers the
  highest-value flows with Playwright against an isolated dev server

### Changed

- **The setup wizard is shorter, and its last step now teaches instead of
  congratulating.** The welcome and appearance steps are gone — one showed a
  logo, the other duplicated Settings — and the root-folder step appears only
  where the tree offers somewhere to point. What replaces "You're all set" is a
  card naming the things nothing else reveals: that typing anything opens
  search, that arrow keys move through the grid, and that `bb` searches from
  the address bar. Each line appears only where the running build actually has
  that capability, so Safari is never promised a new tab page it does not
  replace or a keyword it has no omnibox for

- **Favicons are cached on your machine and Chrome now asks itself first.** Icon
  bytes are stored locally for 30 days, so a site is asked about roughly once a
  month instead of on every render, and cached icons keep working offline.
  Bookmarks sharing a site now cause one lookup between them rather than one
  each. On Chrome the browser's own `_favicon` database is tried before Google —
  it used to be the other way round — so a hit discloses nothing at all. The
  README now documents the provider order and exactly when an origin still
  reaches Google

- **Address-bar search covers whichever source is active**, not only a
  connected daemon vault. Typing `bb` then Tab searches the Active Source's
  bookmarks, and the suggestion line names the source being searched. The
  retiring Standalone Source is the exception — its profiles search from the
  dashboard palette instead
- **The omnibox keyword is now `bb`.** Address-bar search previously required
  typing `bookmarks-but-better` before Tab, which was long enough that the one
  search path reachable from a fresh tab went unused. Existing users need to
  type the new keyword; browsers apply it when the extension updates

- **The Standalone Source is in its sunset period**: new users cannot select
  it anywhere, existing profiles that were using it keep access with a
  deprecation notice, and an explicit copy-based migration (preview, conflict
  handling, verification) moves bookmarks to a Browser or Daemon Source
  without ever deleting the legacy data. Removal lands in the next major
  version
- Connecting a daemon discovers its Vaults and offers each as its own source,
  keeping Browser bookmarks enabled alongside
- Profile-wide preferences (theme, layout width, nested folders) now survive
  source switches unchanged; per-folder layouts and the root folder remain
  scoped to their source
- The dashboard source switcher follows the active theme, has responsive
  spacing, and bookmark cards use the full available width on mobile
- The floating action toolbar now contains only Bookmark Tree and Settings;
  appearance and product information remain available inside Settings

### Removed

- **`bookmarks-but-better setup`.** The daemon binary no longer asks anything:
  the guided first run is `npx bookmarks-but-better`, and every command the
  binary keeps can be driven by a program — `service status --json` joins
  `vault list --json`. The install scripts follow: `--skip-setup`/`-SkipSetup`
  are gone, and `--vault <dir>`/`-Vault <dir>` do the whole first run without a
  terminal — record the vault, initialize it, install and start the service.
  Without it they install the binary and print the next steps. An install over
  a running service now reinstalls the service so it runs the new binary — a
  service installed by 4.0.0, before the registry existed, first has its vaults
  recorded in the registry — and `service install` restarts a running service
  on every platform rather than leaving it on its old command line

### Fixed

- **The Windows installer no longer fails against antivirus, and now survives
  its own second run.** Three separate faults made `install.ps1` unreliable on
  Windows, all of them invisible to a CI that only ever parsed the script on
  Linux. It carried em dashes but no byte-order mark, and Windows PowerShell
  5.1 reads such a file in the machine's ANSI codepage, so a dash inside a
  quoted string closed it early and the whole script failed to parse for anyone
  who downloaded it and ran it rather than piping it to `iex`. It moved the
  unpacked files into place directly after running the new binary, and
  real-time scanning holds a read-only handle on a just-executed file, which
  blocks a move but not a copy; where `%TEMP%` and the install directory sit on
  different volumes that move was also per-file, so a failure part-way had
  already consumed part of the staged directory and no retry could finish it.
  And it removed the `current` junction with `Remove-Item -Force`, which in 5.1
  asks whether to delete the target's contents too, hanging an interactive
  upgrade and failing a non-interactive one. Unpacking is now a copy that
  leaves the source intact, the junction is removed as a directory entry so
  what it points at is never at risk, and the steps that genuinely need delete
  access retry briefly before giving up with an error that names the cause.
  Thanks to @jfpaccini for the report and the diagnosis
  ([#66](https://github.com/farhadeidi/bookmarks-but-better/issues/66))

- Daemon discovery now keeps Source Configuration and the live Source Session
  synchronized when an Active Vault disappears or changes protocol, without
  restarting for a display-label-only rename
- Daemon-only onboarding starts with the Daemon Source selected, so Safari
  users cannot skip the required connection step
- Dev Workbench Reset clears source preferences as well as bookmark trees and
  rejects late writes from the previous scenario
- Development seed scenarios now use the complete bookmark fixture and load
  real favicons with the same fallback behavior as production

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

[4.1.1]: https://github.com/farhadeidi/bookmarks-but-better/compare/v4.1.0...v4.1.1
[4.1.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v4.0.0...v4.1.0
[4.0.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v3.2.1...v4.0.0
[3.2.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v3.1.0...v3.2.0
[3.1.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v2.1.0...v3.0.0
[2.1.0]: https://github.com/farhadeidi/bookmarks-but-better/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/farhadeidi/bookmarks-but-better/releases/tag/v2.0.0
