# Screenshot & Video Automation — Design Spec

**Date:** 2026-04-10
**Branch:** feat/screenshot-automation
**Status:** Approved

---

## Goal

Automate the production of all Chrome Web Store assets — store screenshots, promo tiles, feature walkthrough video/GIF, and theme showcase video/GIF — so they can be regenerated consistently with a single command.

---

## Constraints

- Zero impact on extension bundle size or end-user load time
- All tooling lives in `devDependencies` only
- Uses existing standalone dev server and default seed data
- No mock data setup required

---

## Pipelines

### 1. Screenshots & Promo Tiles (Playwright)

Playwright launches against the running Vite dev server (standalone mode) and captures at exact pixel dimensions.

**Store screenshots (max 5, ordered):**

| File | Dimensions | Content |
|---|---|---|
| `01-dashboard.png` | 1280×800 | Main grid, dark mode, default theme |
| `02-hover-card.png` | 1280×800 | Bookmark card hover state |
| `03-organizer.png` | 1280×800 | Bookmark organizer tree (pro feature) |
| `04-themes.png` | 1280×800 | UI with a featured theme (e.g. Cyberpunk) |
| `05-settings.png` | 1280×800 | Settings panel open |

**Promo tiles:**

| File | Dimensions |
|---|---|
| `promo-small.png` | 440×280 |
| `promo-marquee.png` | 1400×560 |

All outputs land in `docs/screenshots/`.

**URL params used by capture script:**
- `?screenshot=true` — standard capture (dev buttons hidden, wizard suppressed)
- `?screenshot=onboarding` — reserved for future onboarding screenshot if needed

### 2. Feature Walkthrough (Playwright recording)

Scripts real browser interactions against the dev server. Playwright captures frames which ffmpeg stitches into MP4, then converts to GIF.

**Scripted sequence (~20–30 seconds):**
1. Dashboard loads with seed bookmarks and favicons visible
2. Hover over a bookmark card (hover animation)
3. Open organizer, drag-and-drop a bookmark
4. Switch theme from settings panel

**Outputs:**
- `docs/screenshots/feature-walkthrough.mp4`
- `docs/screenshots/feature-walkthrough.gif`

### 3. Theme Showcase (Remotion)

React-based programmatic video. Imports actual `BookmarkGrid` and theme tokens directly — renders identically to the real app using the existing seed data.

**Sequence (~15–20 seconds):**
- Cycles through all 10 themes
- Each theme held for ~1.5s with smooth crossfade transition
- Consistent seed data every render (deterministic output)

**Outputs:**
- `docs/screenshots/theme-showcase.mp4`
- `docs/screenshots/theme-showcase.gif`

---

## Directory Structure

```
bookmarks-but-better/
├── src/
│   └── hooks/
│       └── useScreenshotMode.ts    ← new hook
├── scripts/
│   └── screenshots/
│       ├── capture.ts              ← Playwright: static screenshots + promo tiles
│       └── feature-walkthrough.ts  ← Playwright: interaction recording
├── remotion/
│   ├── compositions/
│   │   └── ThemeShowcase.tsx
│   └── index.ts
├── docs/
│   └── screenshots/                ← all asset outputs committed here
└── package.json
```

---

## npm Scripts

```json
"screenshots":      "playwright scripts/screenshots/capture.ts",
"video:themes":     "remotion render ThemeShowcase docs/screenshots/theme-showcase.mp4",
"video:features":   "tsx scripts/screenshots/feature-walkthrough.ts",
"assets":           "npm run screenshots && npm run video:themes && npm run video:features"
```

---

## `useScreenshotMode` Hook

```ts
// src/hooks/useScreenshotMode.ts
export type ScreenshotMode = false | 'default' | 'onboarding'

export function useScreenshotMode(): ScreenshotMode {
  const param = new URLSearchParams(location.search).get('screenshot')
  if (param === 'onboarding') return 'onboarding'
  if (param === 'true') return 'default'
  return false
}
```

**Rules:**
- Dev-only buttons → hidden when mode is `'default'` or `'onboarding'`
- Wizard modal → shown only when mode is `'onboarding'`, suppressed in `'default'` and in normal dev usage when not set

**Implementation note:** The implementation phase must audit the codebase for every conditional render site (dev-only buttons, wizard modal) and wire them to this hook.

---

## Dependencies Added (all `devDependencies`)

| Package | Purpose |
|---|---|
| `@playwright/test` | Screenshots + interaction recording |
| `remotion` | Theme showcase video composition |
| `@remotion/cli` | Remotion render CLI |
| `@remotion/renderer` | Remotion server-side rendering (includes ffmpeg) |
| `tsx` | Run TypeScript scripts directly |

---

## Key Design Decisions

- **Hybrid approach**: Playwright for real interaction fidelity (feature walkthrough), Remotion for polished programmatic animation (theme showcase)
- **URL query param** over env variables for screenshot mode — no build-time configuration needed, works purely at runtime
- **Separate `remotion/` directory** — never imported by `src/`, invisible to Vite's extension build
- **Seed data reused as-is** — standalone dev mode already loads good seed data; no injection needed
- **ffmpeg via Remotion** — no separate ffmpeg install; `@remotion/renderer` bundles it
