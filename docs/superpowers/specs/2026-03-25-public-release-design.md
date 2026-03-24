# Public Release & Onboarding — Design Spec

**Date:** 2026-03-25
**Status:** Draft

---

## Overview

Prepare "Bookmarks - But Better" for public release on GitHub and the Chrome Web Store. This covers two independent workstreams:

1. **First-run onboarding wizard** — a 4-step wizard that appears once on first launch
2. **Release preparation** — codebase cleanup, README, seed data, screenshots, store listing assets

---

## Part 1: First-Run Onboarding Wizard

### Detection

On app mount (in `App.tsx`), after adapter initialization, check `chrome.storage.local` (or the standalone equivalent) for `onboardingCompleted`. If the flag is absent or `false`, render the `OnboardingWizard` component.

**Important:** This check uses `chrome.storage.local` (not `sync`) so that each device gets its own onboarding, even if the user has the same Chrome profile synced across machines. In standalone mode, this maps to the existing IndexedDB storage adapter.

**Implementation detail:** The `StorageAdapter` interface currently wraps `chrome.storage.sync`. For the onboarding flag, we need a parallel check against `chrome.storage.local`. Options:

- Add a `getLocal` / `setLocal` method to the `StorageAdapter` interface
- Or use `chrome.storage.local` directly in the Chrome adapter and IndexedDB in standalone (since standalone is already per-device)

The simpler approach: use the existing `StorageAdapter` (which is per-device in standalone mode anyway). For Chrome, the flag goes to `sync` — acceptable since the main goal is "show once." If the user installs on a second device with a synced profile, they skip re-onboarding, which is arguably fine for a settings wizard. **Decision: use the existing `StorageAdapter.get/set` for simplicity.** The per-device behavior is a nice-to-have, not a hard requirement.

### Component: `OnboardingWizard`

**Location:** `src/features/onboarding/onboarding-wizard.tsx`

**Rendering:** A centered modal dialog over the blurred dashboard. The dashboard loads normally behind it (bookmarks visible but blurred via `backdrop-filter: blur(12px)` on an overlay div).

**Step management:** Internal state tracks `currentStep` (0–3). CSS transform-based slide animation transitions between steps (slide left on Next, slide right on Back).

**Step indicator:** A row of dots at the bottom of the modal, highlighting the active step.

**Navigation:**
- Back button (hidden on step 0)
- Next button (text changes per step: "Get Started" → "Next" → "Next" → "Start Browsing")
- Skip link on steps 1–2 ("Skip, use defaults") — applies defaults and jumps to step 3

### Step 0: Welcome

- Extension logo (centered)
- Title: "Bookmarks — But Better"
- Tagline: "Your bookmarks, beautifully organized."
- Single "Get Started" button

### Step 1: Root Folder

- Heading: "Choose your bookmark folder"
- Subtext: "Pick a folder to display on your new tab page. You can change this later in settings."
- The `FolderTreePicker` component (extracted from the current settings dialog's `RootFolderPicker`)
- Default selection: Browser Root (all bookmarks)

### Step 2: Appearance

- Heading: "Make it yours"
- Subtext: "Choose a theme and color mode."

**Theme picker:** Grid of theme swatches (small colored squares or cards) representing each of the 10 color themes. Clicking one selects it and applies it live (user sees the dashboard blur change color behind the modal).

**Mode toggle:** Three-option segmented control — Light / Dark / System. Selecting one applies it live.

**Recommended badge:** A small "Recommended" pill/badge on the Default theme swatch, and the Dark mode option is pre-selected as the default. The subtext can mention: "We recommend Default theme with Dark mode."

### Step 3: Done

- Heading: "You're all set!"
- Subtext: "Your new tab is ready. You can always change these in settings."
- "Start Browsing" button

**On completion:** Write all selected preferences to the Zustand stores (which persist via the adapter), set `onboardingCompleted: true` via the storage adapter, and close the wizard.

### Shared Component Extraction: `FolderTreePicker`

The current `RootFolderPicker` in `src/features/settings/root-folder-picker.tsx` uses a native `<select>` element with `collectFolderPaths` to build a flat list of folders with breadcrumb labels. This same component is reused in the wizard. No extraction needed — import it directly.

If the wizard needs a different visual treatment (e.g., styled select instead of native), create a wrapper or pass styling props. But the underlying data logic (`collectFolderPaths`) stays shared.

### Animation Details

**Slide transitions between steps:**
- Container has `overflow: hidden`
- Steps are laid out in a horizontal row (or use absolute positioning)
- On step change, apply CSS `transform: translateX(-N * 100%)` with `transition: transform 300ms ease-in-out`
- Direction: Next slides left, Back slides right

**Modal entrance:** Fade in (opacity 0→1, 200ms) with slight scale (0.95→1).

### Styling

- Modal width: `max-w-lg` (32rem), responsive
- Uses existing shadcn Dialog primitives or a custom modal (overlay + centered content)
- Follows the active color theme — if the user changes theme in step 2, the wizard itself reflects it
- Overlay: semi-transparent dark background + `backdrop-filter: blur(12px)`

---

## Part 2: Release Preparation

### Codebase Cleanup

1. **General sweep:** Scan for hardcoded secrets, API keys, personal paths, debug `console.log` statements, and `TODO`/`FIXME` comments that reference internal context
2. **Move `dev/` → `src/dev/`:** Keep the project root clean. Update all import paths that reference `dev/seed-bookmarks.json`
3. **License file:** Add `LICENSE` file at repo root with MIT license text
4. **Gitignore updates:** Add `.superpowers/` to `.gitignore`
5. **Verify `dist/` is gitignored:** Already confirmed — it is

### Seed Data Update

Replace `dev/seed-bookmarks.json` (which moves to `src/dev/seed-bookmarks.json`) with a curated "best of the internet" collection. Goals:

- Recognizable sites with distinctive favicons that look good in screenshots
- Organized into realistic, relatable folders
- Enough bookmarks to fill the masonry grid attractively (5–7 folders, 4–8 bookmarks each)

**Proposed folder structure:**

| Folder | Bookmarks |
|--------|-----------|
| Social | YouTube, X (Twitter), Reddit, Instagram, TikTok, Discord, Twitch |
| Productivity | Gmail, Google Calendar, Google Drive, Notion, Slack, Todoist |
| Entertainment | Netflix, Spotify, Steam, Crunchyroll, IMDb |
| News & Reading | Hacker News, The Verge, Medium, Substack, Wikipedia |
| Dev Tools | GitHub, Stack Overflow, MDN, VS Code, CodePen, npm |
| Design | Figma, Dribbble, Behance, Unsplash, Coolors |
| AI | Claude, ChatGPT, Perplexity, Midjourney, Hugging Face |

### README Update

The current README is already end-user focused and well-structured. Updates needed:

1. **Screenshots section:** Replace "*Coming soon*" with actual screenshots from `docs/screenshots/`
2. **Chrome Web Store link:** Update the note to include the actual store link once published
3. **License badge:** Add MIT license badge at the top
4. **Development section:** Add brief section for contributors: `bun install`, `bun dev`, `bun run build`

### Screenshots (Automated via agent-browser)

Run `bun dev` to start the standalone dev server with the curated seed data. Use agent-browser to navigate, interact, and capture:

| # | Scenario | Setup |
|---|----------|-------|
| 1 | Dashboard — default theme, dark mode | Load page, set dark mode, capture full viewport |
| 2 | Dashboard — alternate theme | Switch to a visually distinct theme (e.g., Cyberpunk or Claude), capture |
| 3 | Hover card | Hover over a bookmark to show the hover card with actions, capture |
| 4 | Settings dialog | Open settings dialog, capture |
| 5 | Onboarding wizard | Reset onboarding flag, reload, capture the wizard |

**Output:** Save screenshots to `docs/screenshots/` as PNG files. Recommended viewport: 1280x800 (Chrome Web Store standard).

### Chrome Web Store Listing

**Short description (132 char max):**
"A clean, beautiful bookmarks dashboard for your new tab. Masonry layout, 10 themes, dark mode, and full bookmark management."

**Detailed description:**
Cover: what it does, key features (masonry layout, themes, light/dark, edit/delete, import/export, root folder selection), privacy note (no data collection, all data stays in your browser).

**Category:** Productivity

**Tags:** bookmarks, new tab, dashboard, productivity, themes

**Privacy:** No data collection. All bookmark data uses Chrome's built-in bookmarks API. No analytics, no external network requests (except favicon fetches from Google's public favicon service).

**Promotional images:** These require graphic design (440x280 small tile, optional 1400x560 marquee). The spec will note what's needed, but final graphics may need manual creation or a design tool. We can draft text/layout suggestions.

---

## Execution Order

1. Codebase cleanup (sweep, move `dev/`, license, gitignore)
2. Update seed data with curated bookmarks
3. Extract/verify `FolderTreePicker` is importable from settings
4. Build `OnboardingWizard` component (4 steps, animations, modal)
5. Wire up first-run detection in `App.tsx`
6. Automated screenshots via agent-browser (all 5 scenarios)
7. Update README with screenshots and polish
8. Draft Chrome Web Store listing copy

Steps 7 and 8 can run in parallel after step 6.

---

## Out of Scope

- Promotional image graphic design (noted as manual task)
- Firefox/Safari/Edge ports
- Analytics or telemetry
- User accounts or cloud sync beyond Chrome's built-in sync
- Automated Chrome Web Store publishing (manual upload)
