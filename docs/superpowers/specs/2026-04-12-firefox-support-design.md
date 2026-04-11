# Firefox Extension Support — Design Spec

**Date:** 2026-04-12  
**Status:** Approved

---

## Overview

Add Firefox (AMO) support to Bookmarks But Better alongside the existing Chrome build. The extension already uses a clean adapter pattern (`BookmarkAdapter`, `StorageAdapter`, `FaviconProvider`) that makes Firefox a natural extension — most `chrome.*` APIs work unchanged on Firefox.

The output is two separate, fully-packaged builds: `dist-chrome/` and `dist-firefox/`.

---

## Architecture

### New file structure

```
src/browser/
  chrome/                  (unchanged)
  firefox/                 (new)
    bookmarks.ts           delegates to chrome.bookmarks.* — same API, Firefox supports it
    storage.ts             delegates to chrome.storage.sync, Firefox-aware
    favicon.ts             Google Favicon V2 only, no _favicon fallback
  standalone/              (unchanged)
  detect.ts                updated: Firefox detection before Chrome
  types.ts                 updated: AdapterCapabilities added to BrowserAdapter

public/
  manifest.json            Chrome — unchanged
  manifest.firefox.json    new: no favicon permission, adds gecko ID
```

### Capabilities interface (`types.ts`)

A `capabilities` object is added to `BrowserAdapter`. UI components read from it — no browser-sniffing in React code.

```typescript
export interface AdapterCapabilities {
  openInManager: boolean  // Chrome: true | Firefox: false | Standalone: false
  storageSync: boolean    // Chrome: true | Firefox: true* | Standalone: false
}

export interface BrowserAdapter {
  bookmarks: BookmarkAdapter
  storage: StorageAdapter
  favicon: FaviconProvider
  capabilities: AdapterCapabilities
}
```

`storageSync: true` on Firefox means the adapter uses `storage.sync`. Whether it actually syncs across devices depends on whether the user is signed into Firefox Sync (not detectable via API — handled via a UI note).

---

## Firefox Adapters (`src/browser/firefox/`)

### `bookmarks.ts`
Identical in behaviour to `ChromeBookmarkAdapter`. All `chrome.bookmarks.*` and `chrome.tabs.*` calls are supported on Firefox. The only difference: `openInManager` is a no-op. The capability flag (`openInManager: false`) ensures the UI hides the button before it can be called.

### `storage.ts`
Uses `chrome.storage.sync` exactly like the Chrome adapter. Firefox exposes no API to check whether Firefox Sync is active, so no runtime detection is added. The `storageSync: true` capability flag signals the UI to show a static informational note (see UI Changes).

### `favicon.ts`
Uses `GoogleFaviconV2Provider` as the sole provider. Firefox has no equivalent to Chrome's internal `_favicon` API. The existing `GoogleFaviconV2Provider` class is reused directly.

**Coverage:** Google Favicon V2 covers virtually all popular sites. The only gap versus Chrome is obscure/intranet sites not indexed by Google — Chrome falls back to its browsing cache for these. For a typical user's bookmark collection this difference is negligible.

---

## Detection (`detect.ts`)

Firefox is identified via a build-time env variable (`VITE_BUILD_TARGET`) injected by Vite. This is more reliable than user-agent sniffing and has zero runtime cost.

```typescript
function isFirefoxBuild(): boolean {
  return import.meta.env.VITE_BUILD_TARGET === "firefox"
}

// isChromeExtension() renamed to isBrowserExtension()
// (Firefox also passes the chrome.bookmarks / chrome.storage check)

export async function detectAdapter(): Promise<BrowserAdapter> {
  if (isFirefoxBuild() && isBrowserExtension()) return createFirefoxAdapter()
  if (isChromeExtension()) return createChromeAdapter()
  return createStandaloneAdapter()
}
```

---

## Manifests

### `manifest.firefox.json`

```json
{
  "manifest_version": 3,
  "name": "Bookmarks - But Better",
  "description": "A clean, beautiful bookmarks dashboard for your new tab with themes, dark mode, and full bookmark management.",
  "version": "3.1.0",
  "browser_specific_settings": {
    "gecko": {
      "id": "bookmarks-but-better@farhadeidi.com",
      "strict_min_version": "109.0"
    }
  },
  "chrome_url_overrides": { "newtab": "index.html" },
  "permissions": ["bookmarks", "storage", "tabs", "clipboardWrite"],
  "host_permissions": ["https://t1.gstatic.com/*", "https://www.google.com/*"],
  "icons": {
    "16": "icons/icon-16.png",
    "32": "icons/icon-32.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

**Differences from Chrome manifest:**
- Removed: `"favicon"` permission (Chrome-only, causes a warning on Firefox)
- Added: `browser_specific_settings.gecko` with extension ID and minimum Firefox 109

---

## Build System

### `package.json` scripts

```json
"build:chrome":  "VITE_BUILD_TARGET=chrome vite build --outDir dist-chrome",
"build:firefox": "VITE_BUILD_TARGET=firefox vite build --outDir dist-firefox",
"build":         "bun run build:chrome && bun run build:firefox"
```

### `vite.config.ts`

A small plugin copies the correct manifest into the output directory based on `VITE_BUILD_TARGET`:
- `chrome` → copies `public/manifest.json` → `dist-chrome/manifest.json`
- `firefox` → copies `public/manifest.firefox.json` → `dist-firefox/manifest.json`

### Output

```
dist-chrome/    — submit to Chrome Web Store
dist-firefox/   — submit to Firefox Add-ons (AMO)
```

---

## UI Changes

Two targeted changes only — all other UI is unchanged.

### 1. `openInManager` button

Wherever this button is rendered, it is conditionally hidden when `adapter.capabilities.openInManager === false`. No browser-sniffing in JSX.

### 2. Firefox Sync note in Settings

A static informational callout shown only when `adapter.capabilities.storageSync === true` (currently: Firefox adapter only):

> "Your preferences sync across devices via Firefox Sync. If you're not signed into Firefox Sync, settings are saved locally on this device only."

Shown persistently in the Settings panel. No dismissal needed.

---

## Decisions Log

| Area | Decision |
|------|----------|
| Build output | `dist-chrome/` and `dist-firefox/` (symmetric) |
| Firefox adapters | Full `src/browser/firefox/` directory |
| Capabilities | `openInManager`, `storageSync` flags on `BrowserAdapter` |
| `openInManager` on Firefox | Hidden via capability flag |
| Favicon on Firefox | Google Favicon V2 only |
| Storage | `chrome.storage.sync` + static informational note in Settings |
| Manifest | `manifest.firefox.json` — gecko ID, no `favicon` permission |
| Detection | `VITE_BUILD_TARGET` env var injected at build time |
| Firefox extension ID | `bookmarks-but-better@farhadeidi.com` |
| Firefox minimum version | 109.0 (first stable MV3 release) |
