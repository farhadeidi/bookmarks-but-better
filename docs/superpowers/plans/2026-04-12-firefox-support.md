# Firefox Extension Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Firefox-compatible build of Bookmarks But Better alongside Chrome, outputting `dist-chrome/` and `dist-firefox/` from one codebase.

**Architecture:** Add a `src/browser/firefox/` adapter directory (bookmarks, storage, favicon) mirroring the existing `chrome/` structure. Add an `AdapterCapabilities` interface to `BrowserAdapter` so UI components gate features via capability flags rather than browser-sniffing. Detect the target browser at build time via `VITE_BUILD_TARGET` env var.

**Tech Stack:** TypeScript, Vite, Vitest, React, `chrome.*` namespace (supported by both Chrome and Firefox MV3), `bun` for scripts.

---

## File Map

| Action | Path | What changes |
|--------|------|--------------|
| Modify | `src/browser/types.ts` | Add `AdapterCapabilities`, update `BrowserAdapter` |
| Modify | `src/vite-env.d.ts` | Declare `VITE_BUILD_TARGET` on `ImportMetaEnv` |
| Modify | `src/browser/detect.ts` | Rename detection fn, add Firefox factory + wiring |
| Create | `src/browser/firefox/bookmarks.ts` | Firefox bookmark adapter |
| Create | `src/browser/firefox/storage.ts` | Firefox storage adapter |
| Create | `src/browser/firefox/favicon.ts` | Firefox favicon adapter (Google V2 only) |
| Create | `public/manifest.firefox.json` | Firefox-specific manifest |
| Modify | `package.json` | `build:chrome`, `build:firefox`, updated `build` |
| Modify | `src/features/bookmark-card/bookmark-card.tsx` | Hide "View in manager" via capability flag |
| Modify | `src/features/bookmark-item/bookmark-item.tsx` | Hide open-in-manager button via capability flag |
| Modify | `src/features/settings/settings-dialog.tsx` | Add Firefox Sync informational note |

---

## Task 1: Add `AdapterCapabilities` to types and declare build env var

**Files:**
- Modify: `src/browser/types.ts`
- Modify: `src/vite-env.d.ts`

- [ ] **Step 1: Update `src/browser/types.ts`**

Replace the `BrowserAdapter` interface with the version that includes `capabilities`:

```typescript
export interface BookmarkNode {
  id: string
  title: string
  url?: string
  parentId?: string
  children?: BookmarkNode[]
  dateAdded?: number
}

export interface BookmarkAdapter {
  getTree(): Promise<BookmarkNode[]>
  getSubTree(id: string): Promise<BookmarkNode[]>
  create(bookmark: {
    parentId: string
    title: string
    url?: string
  }): Promise<BookmarkNode>
  update(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode>
  remove(id: string): Promise<void>
  removeTree(id: string): Promise<void>
  move(id: string, destination: { parentId?: string; index: number }): Promise<void>
  onChanged(callback: () => void): () => void
  onCreated(callback: () => void): () => void
  onRemoved(callback: () => void): () => void
  onMoved(callback: () => void): () => void
  openInManager(id: string): Promise<void>
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

export interface FaviconProvider {
  getUrl(pageUrl: string): string
  getFallbackUrl?(pageUrl: string): string
  isAvailable(): boolean
}

export interface AdapterCapabilities {
  /** Whether "open in bookmark manager" is supported. False on Firefox and Standalone. */
  openInManager: boolean
  /** Whether preferences use sync storage. True on Chrome and Firefox (Firefox requires Firefox Sync to be active). */
  storageSync: boolean
}

export interface BrowserAdapter {
  bookmarks: BookmarkAdapter
  storage: StorageAdapter
  favicon: FaviconProvider
  capabilities: AdapterCapabilities
}
```

- [ ] **Step 2: Declare `VITE_BUILD_TARGET` in `src/vite-env.d.ts`**

```typescript
/// <reference types="vite/client" />

declare const __APP_VERSION__: string

interface ImportMetaEnv {
  readonly VITE_BUILD_TARGET: 'chrome' | 'firefox' | undefined
}
```

- [ ] **Step 3: Run typecheck — expect zero errors**

```bash
bun run typecheck
```

Expected: passes with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/browser/types.ts src/vite-env.d.ts
git commit -m "feat: add AdapterCapabilities to BrowserAdapter interface"
```

---

## Task 2: Add capabilities to Chrome and Standalone adapter factories

**Files:**
- Modify: `src/browser/detect.ts`

The capabilities object is set in the factory functions in `detect.ts`, not inside the individual adapter classes. This task wires capabilities for the two existing adapters. Firefox wiring comes in Task 6.

- [ ] **Step 1: Update `src/browser/detect.ts`**

Replace the entire file:

```typescript
import type { BrowserAdapter } from "./types"
import { ChromeBookmarkAdapter } from "./chrome/bookmarks"
import { ChromeStorageAdapter } from "./chrome/storage"
import { ChromeFaviconAdapter } from "./chrome/favicon"
import { StandaloneBookmarkAdapter } from "./standalone/bookmarks"
import { StandaloneStorageAdapter } from "./standalone/storage"
import { StandaloneFaviconAdapter } from "./standalone/favicon"

const ADAPTER_PREF_KEY = "adapterMode"

function isBrowserExtension(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      typeof chrome.bookmarks !== "undefined" &&
      typeof chrome.storage !== "undefined"
    )
  } catch {
    return false
  }
}

function isFirefoxBuild(): boolean {
  return import.meta.env.VITE_BUILD_TARGET === "firefox"
}

async function getUserAdapterPreference(): Promise<
  "browser" | "standalone" | null
> {
  return new Promise((resolve) => {
    const request = indexedDB.open("bookmarks-but-better-prefs", 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("preferences")) {
        db.createObjectStore("preferences")
      }
    }
    request.onsuccess = () => {
      const db = request.result
      try {
        const tx = db.transaction("preferences", "readonly")
        const store = tx.objectStore("preferences")
        const getReq = store.get(ADAPTER_PREF_KEY)
        getReq.onsuccess = () => {
          const value = getReq.result
          if (value === "browser" || value === "standalone") {
            resolve(value)
          } else {
            resolve(null)
          }
        }
        getReq.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    }
    request.onerror = () => resolve(null)
  })
}

function createChromeAdapter(): BrowserAdapter {
  return {
    bookmarks: new ChromeBookmarkAdapter(),
    storage: new ChromeStorageAdapter(),
    favicon: new ChromeFaviconAdapter(),
    capabilities: {
      openInManager: true,
      storageSync: true,
    },
  }
}

function createStandaloneAdapter(): BrowserAdapter {
  return {
    bookmarks: new StandaloneBookmarkAdapter(),
    storage: new StandaloneStorageAdapter(),
    favicon: new StandaloneFaviconAdapter(),
    capabilities: {
      openInManager: false,
      storageSync: false,
    },
  }
}

export async function detectAdapter(): Promise<BrowserAdapter> {
  const preference = await getUserAdapterPreference()

  if (isFirefoxBuild() && isBrowserExtension()) {
    // Firefox adapter wired in Task 6
    return createChromeAdapter() // temporary — replaced in Task 6
  }

  if (preference === "standalone") {
    return createStandaloneAdapter()
  }

  if (preference === "browser" && isBrowserExtension()) {
    return createChromeAdapter()
  }

  if (isBrowserExtension()) {
    return createChromeAdapter()
  }

  return createStandaloneAdapter()
}
```

- [ ] **Step 2: Run typecheck — expect zero errors**

```bash
bun run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/browser/detect.ts
git commit -m "feat: add capabilities to Chrome and Standalone adapter factories"
```

---

## Task 3: Create Firefox bookmark adapter

**Files:**
- Create: `src/browser/firefox/bookmarks.ts`

Firefox supports the full `chrome.bookmarks.*` and `chrome.tabs.*` API. The only difference from the Chrome adapter: `openInManager` is a no-op (capability flag handles hiding the button in the UI).

- [ ] **Step 1: Create `src/browser/firefox/bookmarks.ts`**

```typescript
import type { BookmarkAdapter, BookmarkNode } from "../types"

function toBookmarkNode(node: chrome.bookmarks.BookmarkTreeNode): BookmarkNode {
  return {
    id: node.id,
    title: node.title,
    url: node.url,
    parentId: node.parentId,
    dateAdded: node.dateAdded,
    children: node.children?.map(toBookmarkNode),
  }
}

export class FirefoxBookmarkAdapter implements BookmarkAdapter {
  async getTree(): Promise<BookmarkNode[]> {
    const tree = await chrome.bookmarks.getTree()
    return tree.map(toBookmarkNode)
  }

  async getSubTree(id: string): Promise<BookmarkNode[]> {
    const tree = await chrome.bookmarks.getSubTree(id)
    return tree.map(toBookmarkNode)
  }

  async create(bookmark: {
    parentId: string
    title: string
    url?: string
  }): Promise<BookmarkNode> {
    const node = await chrome.bookmarks.create(bookmark)
    return toBookmarkNode(node)
  }

  async update(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode> {
    const node = await chrome.bookmarks.update(id, changes)
    return toBookmarkNode(node)
  }

  async remove(id: string): Promise<void> {
    await chrome.bookmarks.remove(id)
  }

  async removeTree(id: string): Promise<void> {
    await chrome.bookmarks.removeTree(id)
  }

  async move(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<void> {
    const [node] = await chrome.bookmarks.get(id)
    const targetParentId = destination.parentId ?? node.parentId

    let index = destination.index
    if (
      node.parentId === targetParentId &&
      node.index != null &&
      node.index < index
    ) {
      index += 1
    }

    await chrome.bookmarks.move(id, { ...destination, index })
  }

  onChanged(callback: () => void): () => void {
    chrome.bookmarks.onChanged.addListener(callback)
    return () => chrome.bookmarks.onChanged.removeListener(callback)
  }

  onCreated(callback: () => void): () => void {
    chrome.bookmarks.onCreated.addListener(callback)
    return () => chrome.bookmarks.onCreated.removeListener(callback)
  }

  onRemoved(callback: () => void): () => void {
    chrome.bookmarks.onRemoved.addListener(callback)
    return () => chrome.bookmarks.onRemoved.removeListener(callback)
  }

  onMoved(callback: () => void): () => void {
    chrome.bookmarks.onMoved.addListener(callback)
    return () => chrome.bookmarks.onMoved.removeListener(callback)
  }

  // Firefox has no equivalent to chrome://bookmarks — no-op.
  // The UI hides this button when capabilities.openInManager is false.
  async openInManager(): Promise<void> {
    // intentional no-op
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/browser/firefox/bookmarks.ts
git commit -m "feat: add Firefox bookmark adapter"
```

---

## Task 4: Create Firefox storage adapter

**Files:**
- Create: `src/browser/firefox/storage.ts`

Same as Chrome storage adapter — `chrome.storage.sync` is supported on Firefox. Whether it syncs across devices depends on the user's Firefox Sync login, which is not detectable via API. The UI shows a static note (Task 11) when `capabilities.storageSync === true`.

- [ ] **Step 1: Create `src/browser/firefox/storage.ts`**

```typescript
import type { StorageAdapter } from "../types"

export class FirefoxStorageAdapter implements StorageAdapter {
  async get<T>(key: string): Promise<T | null> {
    const result = await chrome.storage.sync.get(key)
    if (key in result) {
      return result[key] as T
    }
    return null
  }

  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.sync.set({ [key]: value })
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.sync.remove(key)
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/browser/firefox/storage.ts
git commit -m "feat: add Firefox storage adapter"
```

---

## Task 5: Create Firefox favicon adapter

**Files:**
- Create: `src/browser/firefox/favicon.ts`

Firefox has no equivalent to Chrome's internal `_favicon` API. Google Favicon V2 is the sole provider. The existing `GoogleFaviconV2Provider` class is reused directly.

- [ ] **Step 1: Create `src/browser/firefox/favicon.ts`**

```typescript
import type { FaviconProvider } from "../types"
import { GoogleFaviconV2Provider } from "../favicon/google-favicon-v2"

const googleV2 = new GoogleFaviconV2Provider()

export class FirefoxFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return googleV2.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/browser/firefox/favicon.ts
git commit -m "feat: add Firefox favicon adapter (Google Favicon V2 only)"
```

---

## Task 6: Wire Firefox adapter into detect.ts

**Files:**
- Modify: `src/browser/detect.ts`

Replace the temporary Chrome fallback for Firefox builds with the real Firefox adapter factory.

- [ ] **Step 1: Update imports and `createFirefoxAdapter` in `src/browser/detect.ts`**

Replace the entire file (building on what was set in Task 2):

```typescript
import type { BrowserAdapter } from "./types"
import { ChromeBookmarkAdapter } from "./chrome/bookmarks"
import { ChromeStorageAdapter } from "./chrome/storage"
import { ChromeFaviconAdapter } from "./chrome/favicon"
import { FirefoxBookmarkAdapter } from "./firefox/bookmarks"
import { FirefoxStorageAdapter } from "./firefox/storage"
import { FirefoxFaviconAdapter } from "./firefox/favicon"
import { StandaloneBookmarkAdapter } from "./standalone/bookmarks"
import { StandaloneStorageAdapter } from "./standalone/storage"
import { StandaloneFaviconAdapter } from "./standalone/favicon"

const ADAPTER_PREF_KEY = "adapterMode"

function isBrowserExtension(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      typeof chrome.bookmarks !== "undefined" &&
      typeof chrome.storage !== "undefined"
    )
  } catch {
    return false
  }
}

function isFirefoxBuild(): boolean {
  return import.meta.env.VITE_BUILD_TARGET === "firefox"
}

async function getUserAdapterPreference(): Promise<
  "browser" | "standalone" | null
> {
  return new Promise((resolve) => {
    const request = indexedDB.open("bookmarks-but-better-prefs", 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("preferences")) {
        db.createObjectStore("preferences")
      }
    }
    request.onsuccess = () => {
      const db = request.result
      try {
        const tx = db.transaction("preferences", "readonly")
        const store = tx.objectStore("preferences")
        const getReq = store.get(ADAPTER_PREF_KEY)
        getReq.onsuccess = () => {
          const value = getReq.result
          if (value === "browser" || value === "standalone") {
            resolve(value)
          } else {
            resolve(null)
          }
        }
        getReq.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    }
    request.onerror = () => resolve(null)
  })
}

function createChromeAdapter(): BrowserAdapter {
  return {
    bookmarks: new ChromeBookmarkAdapter(),
    storage: new ChromeStorageAdapter(),
    favicon: new ChromeFaviconAdapter(),
    capabilities: {
      openInManager: true,
      storageSync: true,
    },
  }
}

function createFirefoxAdapter(): BrowserAdapter {
  return {
    bookmarks: new FirefoxBookmarkAdapter(),
    storage: new FirefoxStorageAdapter(),
    favicon: new FirefoxFaviconAdapter(),
    capabilities: {
      openInManager: false,
      storageSync: true,
    },
  }
}

function createStandaloneAdapter(): BrowserAdapter {
  return {
    bookmarks: new StandaloneBookmarkAdapter(),
    storage: new StandaloneStorageAdapter(),
    favicon: new StandaloneFaviconAdapter(),
    capabilities: {
      openInManager: false,
      storageSync: false,
    },
  }
}

export async function detectAdapter(): Promise<BrowserAdapter> {
  if (isFirefoxBuild() && isBrowserExtension()) {
    return createFirefoxAdapter()
  }

  const preference = await getUserAdapterPreference()

  if (preference === "standalone") {
    return createStandaloneAdapter()
  }

  if (preference === "browser" && isBrowserExtension()) {
    return createChromeAdapter()
  }

  if (isBrowserExtension()) {
    return createChromeAdapter()
  }

  return createStandaloneAdapter()
}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/browser/detect.ts
git commit -m "feat: wire Firefox adapter into detectAdapter"
```

---

## Task 7: Create Firefox manifest

**Files:**
- Create: `public/manifest.firefox.json`

Key differences from `manifest.json`: removes the `"favicon"` permission (Chrome-only), adds `browser_specific_settings` with the gecko ID and minimum Firefox version.

- [ ] **Step 1: Create `public/manifest.firefox.json`**

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
  "chrome_url_overrides": {
    "newtab": "index.html"
  },
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

- [ ] **Step 2: Verify the JSON is valid**

```bash
node -e "JSON.parse(require('fs').readFileSync('public/manifest.firefox.json','utf8')); console.log('valid')"
```

Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add public/manifest.firefox.json
git commit -m "feat: add Firefox manifest with gecko ID and no favicon permission"
```

---

## Task 8: Update build scripts

**Files:**
- Modify: `package.json`

Two new named build scripts. `build` runs both sequentially. The Firefox build overwrites the copied `manifest.json` with the Firefox version post-build.

- [ ] **Step 1: Update scripts in `package.json`**

Replace the existing `"build"` line and add two new scripts:

```json
"build:chrome":  "tsc -b && VITE_BUILD_TARGET=chrome vite build --outDir dist-chrome",
"build:firefox": "VITE_BUILD_TARGET=firefox vite build --outDir dist-firefox && cp public/manifest.firefox.json dist-firefox/manifest.json",
"build":         "bun run build:chrome && bun run build:firefox",
```

The full `scripts` block becomes:

```json
"scripts": {
  "dev": "vite",
  "build:chrome": "tsc -b && VITE_BUILD_TARGET=chrome vite build --outDir dist-chrome",
  "build:firefox": "VITE_BUILD_TARGET=firefox vite build --outDir dist-firefox && cp public/manifest.firefox.json dist-firefox/manifest.json",
  "build": "bun run build:chrome && bun run build:firefox",
  "lint": "eslint .",
  "format": "prettier --write \"**/*.{ts,tsx}\"",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest",
  "preview": "vite preview",
  "screenshots": "playwright test marketing/scripts/capture.spec.ts --config marketing/scripts/playwright.config.ts",
  "video:features": "tsx marketing/scripts/feature-walkthrough.ts",
  "video:themes": "tsx marketing/scripts/theme-showcase.ts",
  "promo": "tsx marketing/scripts/promo.ts",
  "assets": "bun run screenshots && bun run video:features && bun run video:themes && bun run promo"
}
```

- [ ] **Step 2: Run the Chrome build and verify output**

```bash
bun run build:chrome
ls dist-chrome/manifest.json
```

Expected: build succeeds, `dist-chrome/manifest.json` exists.

- [ ] **Step 3: Run the Firefox build and verify manifest**

```bash
bun run build:firefox
node -e "const m = JSON.parse(require('fs').readFileSync('dist-firefox/manifest.json','utf8')); console.log(m.browser_specific_settings?.gecko?.id)"
```

Expected: `bookmarks-but-better@farhadeidi.com`

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add build:chrome and build:firefox scripts with separate output dirs"
```

---

## Task 9: Hide "View in manager" in bookmark-card.tsx

**Files:**
- Modify: `src/features/bookmark-card/bookmark-card.tsx`

Read `adapter.capabilities.openInManager` and conditionally render the dropdown item.

- [ ] **Step 1: Update `FolderMenu` in `src/features/bookmark-card/bookmark-card.tsx`**

In the `FolderMenu` component (around line 42), add `canOpenInManager` derived from the adapter:

```tsx
const adapter = useBookmarkStore((s) => s.adapter)
const canOpenInManager = adapter?.capabilities.openInManager ?? false
```

Then wrap the "View in manager" `DropdownMenuItem` with a conditional:

```tsx
{canOpenInManager && (
  <DropdownMenuItem
    onClick={() => adapter?.bookmarks.openInManager(folder.id)}
  >
    <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
    View in manager
  </DropdownMenuItem>
)}
```

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/bookmark-card/bookmark-card.tsx
git commit -m "feat: hide 'View in manager' when adapter does not support openInManager"
```

---

## Task 10: Hide open-in-manager button in bookmark-item.tsx

**Files:**
- Modify: `src/features/bookmark-item/bookmark-item.tsx`

Two changes: (1) make `onOpenInManager` optional in `HoverCardBody`; (2) pass it from the parent only when the capability is available.

- [ ] **Step 1: Make `onOpenInManager` optional in the `HoverCardBody` props interface**

Find the `HoverCardBody` component (around line 179). Change its props interface:

```tsx
const HoverCardBody = React.memo(function HoverCardBody({
  bookmark,
  onEdit,
  onCopyUrl,
  onDelete,
  onOpenInManager,
}: {
  bookmark: BookmarkNode
  onEdit: (e: React.MouseEvent) => void
  onCopyUrl: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
  onOpenInManager?: (e: React.MouseEvent) => void   // ← was required, now optional
}) {
```

- [ ] **Step 2: Wrap the open-in-manager `Tooltip` with a conditional**

In the `HoverCardBody` render (around line 229), wrap the tooltip block:

```tsx
{onOpenInManager && (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenInManager}
        />
      }
    >
      <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
    </TooltipTrigger>
    <TooltipContent>Show in bookmark manager</TooltipContent>
  </Tooltip>
)}
```

- [ ] **Step 3: Pass `onOpenInManager` conditionally from the `BookmarkItem` parent**

In the `BookmarkItem` component (around line 42), read the capability:

```tsx
const adapter = useBookmarkStore((s) => s.adapter)
const canOpenInManager = adapter?.capabilities.openInManager ?? false
```

Then pass `onOpenInManager` to both `HoverCardBody` instances only when supported:

```tsx
<HoverCardBody
  bookmark={bookmark}
  onEdit={handleEdit}
  onCopyUrl={handleCopyUrl}
  onDelete={handleDelete}
  onOpenInManager={canOpenInManager ? handleOpenInManager : undefined}
/>
```

Apply the same change to the second `HoverCardBody` call (the list layout version).

- [ ] **Step 4: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/features/bookmark-item/bookmark-item.tsx
git commit -m "feat: hide open-in-manager button when capability is unavailable"
```

---

## Task 11: Add Firefox Sync note to settings-dialog.tsx

**Files:**
- Modify: `src/features/settings/settings-dialog.tsx`

Show an informational note when `adapter.capabilities.storageSync` is `true`. This currently only applies to the Firefox adapter. Chrome users already have sync working and don't need the note. Standalone has no sync at all.

- [ ] **Step 1: Read `capabilities.storageSync` in `SettingsDialog`**

In `SettingsDialog` (around line 33 where `adapter` is already read):

```tsx
const adapter = useBookmarkStore((s) => s.adapter)
const showSyncNote = adapter?.capabilities.storageSync ?? false
```

- [ ] **Step 2: Add the sync note to the settings content**

Inside the scrollable `<div className="flex flex-col gap-6">`, add the note at the top:

```tsx
{showSyncNote && (
  <div className="rounded-md bg-muted px-3 py-2.5 text-xs text-muted-foreground">
    Your preferences sync across devices via Firefox Sync. If you&apos;re
    not signed into Firefox Sync, settings are saved locally on this
    device only.
  </div>
)}
```

- [ ] **Step 3: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/settings/settings-dialog.tsx
git commit -m "feat: show Firefox Sync informational note in settings when storageSync capability is true"
```

---

## Task 12: Final verification

- [ ] **Step 1: Run all tests**

```bash
bun run test
```

Expected: all existing tests pass. (No new unit tests for browser adapters — they wrap `chrome.*` APIs that require a real extension context.)

- [ ] **Step 2: Run typecheck**

```bash
bun run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Run both builds end-to-end**

```bash
bun run build
```

Expected: both builds complete without errors.

- [ ] **Step 4: Confirm Chrome manifest is unchanged**

```bash
node -e "const m = JSON.parse(require('fs').readFileSync('dist-chrome/manifest.json','utf8')); console.log('permissions:', m.permissions); console.log('gecko:', m.browser_specific_settings)"
```

Expected: `permissions` includes `"favicon"`, `gecko` is `undefined`.

- [ ] **Step 5: Confirm Firefox manifest is correct**

```bash
node -e "const m = JSON.parse(require('fs').readFileSync('dist-firefox/manifest.json','utf8')); console.log('id:', m.browser_specific_settings.gecko.id); console.log('has favicon perm:', m.permissions.includes('favicon'))"
```

Expected: `id: bookmarks-but-better@farhadeidi.com`, `has favicon perm: false`.

- [ ] **Step 6: Final commit**

```bash
git commit --allow-empty -m "chore: Firefox extension support complete — dist-chrome and dist-firefox ready"
```
