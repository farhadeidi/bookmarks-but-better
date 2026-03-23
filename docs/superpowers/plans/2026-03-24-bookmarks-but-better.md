# Bookmarks - But Better Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Chrome extension that replaces the new tab page with a masonry bookmarks dashboard, supporting both browser bookmarks and a standalone IndexedDB-backed mode with import/export.

**Architecture:** Layered system with browser adapter interfaces (Chrome + standalone), three isolated Zustand stores (bookmarks, preferences, UI), and compositional feature components. All browser-specific code lives behind adapter interfaces.

**Tech Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, shadcn + Base UI, Zustand, @masonry-grid/react, bun, Chrome Manifest V3

---

## File Map

### New files to create

**Browser adapter layer:**
- `src/browser/types.ts` — BookmarkNode, BookmarkAdapter, StorageAdapter, FaviconProvider, BrowserAdapter interfaces
- `src/browser/chrome/bookmarks.ts` — Chrome bookmarks API wrapper
- `src/browser/chrome/storage.ts` — Chrome storage.sync wrapper
- `src/browser/chrome/favicon.ts` — Chrome favicon adapter (chains chrome:// and Google)
- `src/browser/standalone/bookmarks.ts` — IndexedDB-backed bookmark tree
- `src/browser/standalone/storage.ts` — IndexedDB-backed preferences
- `src/browser/standalone/favicon.ts` — Google S2 favicon adapter
- `src/browser/favicon/types.ts` — FaviconProvider interface (re-export from types.ts)
- `src/browser/favicon/chrome-favicon.ts` — chrome://favicon provider
- `src/browser/favicon/google-favicon.ts` — Google S2 favicon provider
- `src/browser/import-export/netscape-parser.ts` — Parse Netscape bookmark HTML to BookmarkNode tree
- `src/browser/import-export/netscape-serializer.ts` — Serialize BookmarkNode tree to Netscape HTML
- `src/browser/detect.ts` — Environment detection and adapter instantiation
- `src/browser/index.ts` — Re-exports the active adapter

**Stores:**
- `src/stores/bookmark-store.ts` — Bookmark tree state and mutations
- `src/stores/preferences-store.ts` — User preferences with persistence
- `src/stores/ui-store.ts` — Transient UI state (dialogs, etc.)

**Features:**
- `src/features/bookmark-grid/bookmark-grid.tsx` — Masonry grid of folder cards
- `src/features/bookmark-grid/index.ts` — Re-export
- `src/features/bookmark-card/bookmark-card.tsx` — Folder card component
- `src/features/bookmark-card/index.ts` — Re-export
- `src/features/bookmark-item/bookmark-item.tsx` — Single bookmark link with hover card
- `src/features/bookmark-item/favicon.tsx` — Favicon image with fallback chain
- `src/features/bookmark-item/index.ts` — Re-export
- `src/features/settings/settings-dialog.tsx` — Settings dialog
- `src/features/settings/root-folder-picker.tsx` — Folder tree picker
- `src/features/settings/index.ts` — Re-export
- `src/features/bookmark-editor/bookmark-editor-dialog.tsx` — Edit bookmark/folder dialog
- `src/features/bookmark-editor/index.ts` — Re-export
- `src/features/delete-confirm/delete-confirm-dialog.tsx` — Delete confirmation dialog
- `src/features/delete-confirm/index.ts` — Re-export

**Shared types:**
- `src/types/bookmark.ts` — Re-exports BookmarkNode from browser/types for use in features

**Extension:**
- `public/manifest.json` — Chrome MV3 manifest
- `public/icons/icon-16.png` — Extension icon 16px
- `public/icons/icon-48.png` — Extension icon 48px
- `public/icons/icon-128.png` — Extension icon 128px

**Dev:**
- `dev/seed-bookmarks.json` — Sample bookmark tree for dev/standalone mode

### Files to modify
- `src/App.tsx` — Replace placeholder with full app layout
- `src/main.tsx` — No changes expected (ThemeProvider + TooltipProvider already set up)
- `index.html` — Update title from "vite-app" to "Bookmarks - But Better"
- `package.json` — Add zustand, @masonry-grid/react dependencies

---

## Task 1: Install dependencies and update project metadata

**Files:**
- Modify: `package.json`
- Modify: `index.html`

- [ ] **Step 1: Install zustand and @masonry-grid/react**

Run:
```bash
bun add zustand @masonry-grid/react
```

- [ ] **Step 2: Update HTML title**

In `index.html`, change:
```html
<title>vite-app</title>
```
to:
```html
<title>Bookmarks - But Better</title>
```

- [ ] **Step 3: Verify the app still builds**

Run:
```bash
bun run build
```
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock index.html
git commit -m "chore: add zustand and @masonry-grid/react, update page title"
```

---

## Task 2: Browser adapter interfaces and shared types

**Files:**
- Create: `src/browser/types.ts`
- Create: `src/browser/favicon/types.ts`
- Create: `src/types/bookmark.ts`

- [ ] **Step 1: Create the adapter interfaces**

Create `src/browser/types.ts`:
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
  onChanged(callback: () => void): () => void
  onCreated(callback: () => void): () => void
  onRemoved(callback: () => void): () => void
  onMoved(callback: () => void): () => void
}

export interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

export interface FaviconProvider {
  getUrl(pageUrl: string): string
  isAvailable(): boolean
}

export interface BrowserAdapter {
  bookmarks: BookmarkAdapter
  storage: StorageAdapter
  favicon: FaviconProvider
}
```

- [ ] **Step 2: Create the favicon types re-export**

Create `src/browser/favicon/types.ts`:
```typescript
export type { FaviconProvider } from "../types"
```

- [ ] **Step 3: Create the shared bookmark type re-export**

Create `src/types/bookmark.ts`:
```typescript
export type { BookmarkNode } from "../browser/types"
```

- [ ] **Step 4: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/browser/types.ts src/browser/favicon/types.ts src/types/bookmark.ts
git commit -m "feat: add browser adapter interfaces and shared types"
```

---

## Task 3: Favicon providers

**Files:**
- Create: `src/browser/favicon/chrome-favicon.ts`
- Create: `src/browser/favicon/google-favicon.ts`

- [ ] **Step 1: Create the Google S2 favicon provider**

Create `src/browser/favicon/google-favicon.ts`:
```typescript
import type { FaviconProvider } from "./types"

export class GoogleFaviconProvider implements FaviconProvider {
  getUrl(pageUrl: string): string {
    try {
      const domain = new URL(pageUrl).hostname
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
    } catch {
      return ""
    }
  }

  isAvailable(): boolean {
    return true
  }
}
```

- [ ] **Step 2: Create the Chrome favicon provider**

Create `src/browser/favicon/chrome-favicon.ts`:
```typescript
import type { FaviconProvider } from "./types"

export class ChromeFaviconProvider implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return `chrome://favicon/size/16@2x/${pageUrl}`
  }

  isAvailable(): boolean {
    try {
      return (
        typeof chrome !== "undefined" &&
        typeof chrome.runtime !== "undefined" &&
        typeof chrome.runtime.id === "string"
      )
    } catch {
      return false
    }
  }
}
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/browser/favicon/
git commit -m "feat: add Chrome and Google S2 favicon providers"
```

---

## Task 4: Chrome adapter implementation

**Files:**
- Create: `src/browser/chrome/bookmarks.ts`
- Create: `src/browser/chrome/storage.ts`
- Create: `src/browser/chrome/favicon.ts`

- [ ] **Step 1: Create Chrome bookmarks adapter**

Create `src/browser/chrome/bookmarks.ts`:
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

export class ChromeBookmarkAdapter implements BookmarkAdapter {
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
}
```

- [ ] **Step 2: Create Chrome storage adapter**

Create `src/browser/chrome/storage.ts`:
```typescript
import type { StorageAdapter } from "../types"

export class ChromeStorageAdapter implements StorageAdapter {
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

- [ ] **Step 3: Create Chrome favicon adapter**

This adapter composes the Chrome and Google providers. The primary URL comes from Chrome; the fallback is handled at the component level via `onError`.

Create `src/browser/chrome/favicon.ts`:
```typescript
import type { FaviconProvider } from "../types"
import { ChromeFaviconProvider } from "../favicon/chrome-favicon"
import { GoogleFaviconProvider } from "../favicon/google-favicon"

const chromeFavicon = new ChromeFaviconProvider()
const googleFavicon = new GoogleFaviconProvider()

export class ChromeFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    if (chromeFavicon.isAvailable()) {
      return chromeFavicon.getUrl(pageUrl)
    }
    return googleFavicon.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }

  getFallbackUrl(pageUrl: string): string {
    return googleFavicon.getUrl(pageUrl)
  }
}
```

- [ ] **Step 4: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors (Chrome types may not be available outside extension context — if typecheck fails on `chrome.*`, add `@types/chrome` as a dev dependency: `bun add -d @types/chrome`).

- [ ] **Step 5: Commit**

```bash
git add src/browser/chrome/
git commit -m "feat: add Chrome adapter implementations (bookmarks, storage, favicon)"
```

---

## Task 5: Standalone adapter — IndexedDB bookmarks

**Files:**
- Create: `src/browser/standalone/bookmarks.ts`

This is the most complex adapter. It stores bookmark nodes in IndexedDB and maintains the tree via `parentId` references.

- [ ] **Step 1: Create the standalone bookmarks adapter**

Create `src/browser/standalone/bookmarks.ts`:
```typescript
import type { BookmarkAdapter, BookmarkNode } from "../types"

const DB_NAME = "bookmarks-but-better"
const DB_VERSION = 1
const STORE_NAME = "bookmarks"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" })
        store.createIndex("parentId", "parentId", { unique: false })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

interface StoredBookmark {
  id: string
  title: string
  url?: string
  parentId?: string
  dateAdded: number
}

function generateId(): string {
  return crypto.randomUUID()
}

async function getAllBookmarks(db: IDBDatabase): Promise<StoredBookmark[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function buildTree(bookmarks: StoredBookmark[]): BookmarkNode[] {
  const map = new Map<string, BookmarkNode>()
  const roots: BookmarkNode[] = []

  for (const b of bookmarks) {
    map.set(b.id, {
      id: b.id,
      title: b.title,
      url: b.url,
      parentId: b.parentId,
      dateAdded: b.dateAdded,
      children: [],
    })
  }

  for (const node of map.values()) {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children!.push(node)
    } else if (!node.parentId) {
      roots.push(node)
    }
  }

  return roots
}

async function putBookmark(
  db: IDBDatabase,
  bookmark: StoredBookmark
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const request = store.put(bookmark)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function deleteBookmark(db: IDBDatabase, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite")
    const store = tx.objectStore(STORE_NAME)
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
}

async function getChildIds(db: IDBDatabase, id: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly")
    const store = tx.objectStore(STORE_NAME)
    const index = store.index("parentId")
    const request = index.getAll(id)
    request.onsuccess = () => {
      const children = request.result as StoredBookmark[]
      resolve(children.map((c) => c.id))
    }
    request.onerror = () => reject(request.error)
  })
}

async function deleteTreeRecursive(
  db: IDBDatabase,
  id: string
): Promise<void> {
  const childIds = await getChildIds(db, id)
  for (const childId of childIds) {
    await deleteTreeRecursive(db, childId)
  }
  await deleteBookmark(db, id)
}

export class StandaloneBookmarkAdapter implements BookmarkAdapter {
  private db: IDBDatabase | null = null

  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDB()
    }
    return this.db
  }

  async getTree(): Promise<BookmarkNode[]> {
    const db = await this.getDB()
    const all = await getAllBookmarks(db)

    if (all.length === 0) {
      const root: StoredBookmark = {
        id: "0",
        title: "",
        dateAdded: Date.now(),
      }
      await putBookmark(db, root)
      return buildTree([root])
    }

    return buildTree(all)
  }

  async getSubTree(id: string): Promise<BookmarkNode[]> {
    const tree = await this.getTree()

    function findNode(nodes: BookmarkNode[]): BookmarkNode | null {
      for (const node of nodes) {
        if (node.id === id) return node
        if (node.children) {
          const found = findNode(node.children)
          if (found) return found
        }
      }
      return null
    }

    const node = findNode(tree)
    return node ? [node] : []
  }

  async create(bookmark: {
    parentId: string
    title: string
    url?: string
  }): Promise<BookmarkNode> {
    const db = await this.getDB()
    const stored: StoredBookmark = {
      id: generateId(),
      title: bookmark.title,
      url: bookmark.url,
      parentId: bookmark.parentId,
      dateAdded: Date.now(),
    }
    await putBookmark(db, stored)
    return {
      id: stored.id,
      title: stored.title,
      url: stored.url,
      parentId: stored.parentId,
      dateAdded: stored.dateAdded,
      children: [],
    }
  }

  async update(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<BookmarkNode> {
    const db = await this.getDB()
    const all = await getAllBookmarks(db)
    const existing = all.find((b) => b.id === id)
    if (!existing) {
      throw new Error(`Bookmark not found: ${id}`)
    }
    const updated: StoredBookmark = {
      ...existing,
      ...(changes.title !== undefined && { title: changes.title }),
      ...(changes.url !== undefined && { url: changes.url }),
    }
    await putBookmark(db, updated)
    return {
      id: updated.id,
      title: updated.title,
      url: updated.url,
      parentId: updated.parentId,
      dateAdded: updated.dateAdded,
      children: [],
    }
  }

  async remove(id: string): Promise<void> {
    const db = await this.getDB()
    await deleteBookmark(db, id)
  }

  async removeTree(id: string): Promise<void> {
    const db = await this.getDB()
    await deleteTreeRecursive(db, id)
  }

  // Standalone mode: no external events. The store calls refresh() after mutations.
  onChanged(_callback: () => void): () => void {
    return () => {}
  }

  onCreated(_callback: () => void): () => void {
    return () => {}
  }

  onRemoved(_callback: () => void): () => void {
    return () => {}
  }

  onMoved(_callback: () => void): () => void {
    return () => {}
  }
}
```

- [ ] **Step 2: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/browser/standalone/bookmarks.ts
git commit -m "feat: add standalone IndexedDB bookmark adapter"
```

---

## Task 6: Standalone adapter — storage and favicon

**Files:**
- Create: `src/browser/standalone/storage.ts`
- Create: `src/browser/standalone/favicon.ts`

- [ ] **Step 1: Create standalone storage adapter**

Create `src/browser/standalone/storage.ts`:
```typescript
import type { StorageAdapter } from "../types"

const DB_NAME = "bookmarks-but-better-prefs"
const DB_VERSION = 1
const STORE_NAME = "preferences"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export class StandaloneStorageAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null

  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDB()
    }
    return this.db
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(key)
      request.onsuccess = () => {
        resolve(request.result !== undefined ? (request.result as T) : null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      const request = store.put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async remove(key: string): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
```

- [ ] **Step 2: Create standalone favicon adapter**

Create `src/browser/standalone/favicon.ts`:
```typescript
import type { FaviconProvider } from "../types"
import { GoogleFaviconProvider } from "../favicon/google-favicon"

const googleFavicon = new GoogleFaviconProvider()

export class StandaloneFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return googleFavicon.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }
}
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/browser/standalone/storage.ts src/browser/standalone/favicon.ts
git commit -m "feat: add standalone storage and favicon adapters"
```

---

## Task 7: Adapter detection and main export

**Files:**
- Create: `src/browser/detect.ts`
- Create: `src/browser/index.ts`

- [ ] **Step 1: Create the environment detection module**

Create `src/browser/detect.ts`:
```typescript
import type { BrowserAdapter } from "./types"
import { ChromeBookmarkAdapter } from "./chrome/bookmarks"
import { ChromeStorageAdapter } from "./chrome/storage"
import { ChromeFaviconAdapter } from "./chrome/favicon"
import { StandaloneBookmarkAdapter } from "./standalone/bookmarks"
import { StandaloneStorageAdapter } from "./standalone/storage"
import { StandaloneFaviconAdapter } from "./standalone/favicon"

const ADAPTER_PREF_KEY = "adapter-mode"

function isChromeExtension(): boolean {
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
  }
}

function createStandaloneAdapter(): BrowserAdapter {
  return {
    bookmarks: new StandaloneBookmarkAdapter(),
    storage: new StandaloneStorageAdapter(),
    favicon: new StandaloneFaviconAdapter(),
  }
}

export async function detectAdapter(): Promise<BrowserAdapter> {
  const preference = await getUserAdapterPreference()

  if (preference === "standalone") {
    return createStandaloneAdapter()
  }

  if (preference === "browser" && isChromeExtension()) {
    return createChromeAdapter()
  }

  if (isChromeExtension()) {
    return createChromeAdapter()
  }

  return createStandaloneAdapter()
}
```

- [ ] **Step 2: Create the main browser export**

Create `src/browser/index.ts`:
```typescript
export { detectAdapter } from "./detect"
export type {
  BookmarkNode,
  BookmarkAdapter,
  StorageAdapter,
  FaviconProvider,
  BrowserAdapter,
} from "./types"
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/browser/detect.ts src/browser/index.ts
git commit -m "feat: add adapter detection and browser module exports"
```

---

## Task 8: Seed data for dev mode

**Files:**
- Create: `dev/seed-bookmarks.json`

- [ ] **Step 1: Create the seed bookmark data**

Create `dev/seed-bookmarks.json` with a realistic bookmark tree matching what you'd see in a browser:
```json
[
  {
    "id": "0",
    "title": "",
    "children": [
      {
        "id": "1",
        "title": "Bookmarks Bar",
        "parentId": "0",
        "children": [
          {
            "id": "10",
            "title": "Quick Access",
            "parentId": "1",
            "children": [
              { "id": "100", "title": "YouTube", "url": "https://youtube.com", "parentId": "10" },
              { "id": "101", "title": "GitHub", "url": "https://github.com", "parentId": "10" },
              { "id": "102", "title": "Twitter", "url": "https://x.com", "parentId": "10" },
              { "id": "103", "title": "LinkedIn", "url": "https://linkedin.com", "parentId": "10" },
              { "id": "104", "title": "Reddit", "url": "https://reddit.com", "parentId": "10" },
              { "id": "105", "title": "Stack Overflow", "url": "https://stackoverflow.com", "parentId": "10" }
            ]
          },
          {
            "id": "11",
            "title": "Development",
            "parentId": "1",
            "children": [
              { "id": "110", "title": "MDN Web Docs", "url": "https://developer.mozilla.org", "parentId": "11" },
              { "id": "111", "title": "TypeScript Docs", "url": "https://typescriptlang.org/docs", "parentId": "11" },
              { "id": "112", "title": "React Documentation", "url": "https://react.dev", "parentId": "11" },
              { "id": "113", "title": "Tailwind CSS", "url": "https://tailwindcss.com/docs", "parentId": "11" },
              { "id": "114", "title": "Vite", "url": "https://vite.dev", "parentId": "11" },
              {
                "id": "115",
                "title": "APIs",
                "parentId": "11",
                "children": [
                  { "id": "1150", "title": "JSONPlaceholder", "url": "https://jsonplaceholder.typicode.com", "parentId": "115" },
                  { "id": "1151", "title": "DummyJSON", "url": "https://dummyjson.com", "parentId": "115" }
                ]
              }
            ]
          },
          {
            "id": "12",
            "title": "AI",
            "parentId": "1",
            "children": [
              { "id": "120", "title": "ChatGPT", "url": "https://chat.openai.com", "parentId": "12" },
              { "id": "121", "title": "Claude", "url": "https://claude.ai", "parentId": "12" },
              { "id": "122", "title": "Google Gemini", "url": "https://gemini.google.com", "parentId": "12" },
              { "id": "123", "title": "Perplexity", "url": "https://perplexity.ai", "parentId": "12" }
            ]
          },
          {
            "id": "13",
            "title": "Design",
            "parentId": "1",
            "children": [
              { "id": "130", "title": "Figma", "url": "https://figma.com", "parentId": "13" },
              { "id": "131", "title": "Dribbble", "url": "https://dribbble.com", "parentId": "13" },
              { "id": "132", "title": "Mobbin", "url": "https://mobbin.com", "parentId": "13" }
            ]
          },
          {
            "id": "14",
            "title": "Productivity",
            "parentId": "1",
            "children": [
              { "id": "140", "title": "Gmail", "url": "https://mail.google.com", "parentId": "14" },
              { "id": "141", "title": "Google Calendar", "url": "https://calendar.google.com", "parentId": "14" },
              { "id": "142", "title": "Notion", "url": "https://notion.so", "parentId": "14" },
              { "id": "143", "title": "Linear", "url": "https://linear.app", "parentId": "14" }
            ]
          }
        ]
      },
      {
        "id": "2",
        "title": "Other Bookmarks",
        "parentId": "0",
        "children": [
          { "id": "200", "title": "Wikipedia", "url": "https://wikipedia.org", "parentId": "2" }
        ]
      }
    ]
  }
]
```

- [ ] **Step 2: Add seed loading to standalone bookmarks adapter**

In `src/browser/standalone/bookmarks.ts`, add a method and import the seed on first empty load. Add this method to the `StandaloneBookmarkAdapter` class:

At the top of the file, add:
```typescript
import seedData from "../../../dev/seed-bookmarks.json"
```

Add a private method to the class:
```typescript
private async seedFromDevData(db: IDBDatabase): Promise<void> {
  function flattenNodes(
    nodes: BookmarkNode[],
    result: StoredBookmark[] = []
  ): StoredBookmark[] {
    for (const node of nodes) {
      result.push({
        id: node.id,
        title: node.title,
        url: node.url,
        parentId: node.parentId,
        dateAdded: node.dateAdded ?? Date.now(),
      })
      if (node.children) {
        flattenNodes(node.children, result)
      }
    }
    return result
  }

  const flat = flattenNodes(seedData as BookmarkNode[])
  const tx = db.transaction(STORE_NAME, "readwrite")
  const store = tx.objectStore(STORE_NAME)
  for (const bookmark of flat) {
    store.put(bookmark)
  }
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}
```

Update the `getTree()` method to seed on first empty load:
```typescript
async getTree(): Promise<BookmarkNode[]> {
  const db = await this.getDB()
  const all = await getAllBookmarks(db)

  if (all.length === 0) {
    await this.seedFromDevData(db)
    const seeded = await getAllBookmarks(db)
    return buildTree(seeded)
  }

  return buildTree(all)
}
```

- [ ] **Step 3: Add JSON module resolution to tsconfig**

In `tsconfig.app.json`, ensure `resolveJsonModule` and `allowImportingTsExtensions` are set. Check first — if `resolveJsonModule: true` is already there, skip this step.

- [ ] **Step 4: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add dev/seed-bookmarks.json src/browser/standalone/bookmarks.ts
git commit -m "feat: add seed bookmark data and auto-seeding for dev mode"
```

---

## Task 9: Import/Export — Netscape bookmark parser

**Files:**
- Create: `src/browser/import-export/netscape-parser.ts`

- [ ] **Step 1: Create the Netscape bookmark HTML parser**

Create `src/browser/import-export/netscape-parser.ts`:
```typescript
import type { BookmarkNode } from "../types"

/**
 * Parses the standard Netscape Bookmark HTML format exported by browsers.
 * Structure: nested <DL> lists with <DT> entries for folders and links.
 */
export function parseNetscapeBookmarks(html: string): BookmarkNode[] {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, "text/html")
  const rootDL = doc.querySelector("DL")

  if (!rootDL) {
    return []
  }

  let idCounter = 1

  function generateId(): string {
    return String(idCounter++)
  }

  function parseDL(
    dl: Element,
    parentId?: string
  ): BookmarkNode[] {
    const nodes: BookmarkNode[] = []
    const children = Array.from(dl.children)

    for (let i = 0; i < children.length; i++) {
      const child = children[i]

      if (child.tagName !== "DT") continue

      const anchor = child.querySelector(":scope > A")
      const heading = child.querySelector(":scope > H3")

      if (anchor) {
        // It's a bookmark link
        const id = generateId()
        nodes.push({
          id,
          title: anchor.textContent?.trim() ?? "",
          url: anchor.getAttribute("HREF") ?? "",
          parentId,
          dateAdded: parseAddDate(anchor.getAttribute("ADD_DATE")),
          children: undefined,
        })
      } else if (heading) {
        // It's a folder — the next sibling should be a <DL>
        const id = generateId()
        const nextSibling = children[i + 1]
        const nestedDL =
          nextSibling?.tagName === "DL"
            ? nextSibling
            : child.querySelector(":scope > DL")

        const folderChildren = nestedDL ? parseDL(nestedDL, id) : []

        nodes.push({
          id,
          title: heading.textContent?.trim() ?? "",
          parentId,
          dateAdded: parseAddDate(heading.getAttribute("ADD_DATE")),
          children: folderChildren,
        })

        // Skip the DL we just consumed
        if (nextSibling?.tagName === "DL") {
          i++
        }
      }
    }

    return nodes
  }

  function parseAddDate(value: string | null): number | undefined {
    if (!value) return undefined
    const timestamp = parseInt(value, 10)
    if (isNaN(timestamp)) return undefined
    // Netscape format uses seconds since epoch
    return timestamp * 1000
  }

  const rootId = "0"
  const rootChildren = parseDL(rootDL, rootId)

  return [
    {
      id: rootId,
      title: "",
      children: rootChildren,
    },
  ]
}
```

- [ ] **Step 2: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/browser/import-export/netscape-parser.ts
git commit -m "feat: add Netscape bookmark HTML parser"
```

---

## Task 10: Import/Export — Netscape bookmark serializer

**Files:**
- Create: `src/browser/import-export/netscape-serializer.ts`

- [ ] **Step 1: Create the Netscape bookmark HTML serializer**

Create `src/browser/import-export/netscape-serializer.ts`:
```typescript
import type { BookmarkNode } from "../types"

/**
 * Serializes a BookmarkNode tree to standard Netscape Bookmark HTML format.
 * This format is importable by all major browsers.
 */
export function serializeNetscapeBookmarks(tree: BookmarkNode[]): string {
  const lines: string[] = [
    "<!DOCTYPE NETSCAPE-Bookmark-file-1>",
    "<!-- This is an automatically generated file.",
    "     It will be read and overwritten.",
    "     DO NOT EDIT! -->",
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    "<TITLE>Bookmarks</TITLE>",
    "<H1>Bookmarks</H1>",
  ]

  function serializeNodes(nodes: BookmarkNode[], indent: number): void {
    const pad = "    ".repeat(indent)
    lines.push(`${pad}<DL><p>`)

    for (const node of nodes) {
      if (node.url) {
        // Bookmark link
        const addDate = node.dateAdded
          ? ` ADD_DATE="${Math.floor(node.dateAdded / 1000)}"`
          : ""
        lines.push(
          `${pad}    <DT><A HREF="${escapeHtml(node.url)}"${addDate}>${escapeHtml(node.title)}</A>`
        )
      } else if (node.children) {
        // Folder
        const addDate = node.dateAdded
          ? ` ADD_DATE="${Math.floor(node.dateAdded / 1000)}"`
          : ""
        lines.push(
          `${pad}    <DT><H3${addDate}>${escapeHtml(node.title)}</H3>`
        )
        serializeNodes(node.children, indent + 1)
      }
    }

    lines.push(`${pad}</DL><p>`)
  }

  // Start from root's children (skip the root node itself)
  const rootChildren =
    tree.length === 1 && tree[0].children ? tree[0].children : tree

  serializeNodes(rootChildren, 0)

  return lines.join("\n")
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}
```

- [ ] **Step 2: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/browser/import-export/netscape-serializer.ts
git commit -m "feat: add Netscape bookmark HTML serializer"
```

---

## Task 11: Zustand stores — bookmark store

**Files:**
- Create: `src/stores/bookmark-store.ts`

- [ ] **Step 1: Create the bookmark store**

Create `src/stores/bookmark-store.ts`:
```typescript
import { create } from "zustand"
import type { BookmarkNode, BrowserAdapter } from "@/browser"

interface BookmarkState {
  tree: BookmarkNode[]
  rootFolderId: string | null
  isLoading: boolean
  adapter: BrowserAdapter | null

  // Derived
  rootFolder: BookmarkNode | null

  // Actions
  init(adapter: BrowserAdapter): Promise<void>
  setRootFolderId(id: string | null): void
  refresh(): Promise<void>
  createBookmark(parentId: string, title: string, url: string): Promise<void>
  updateBookmark(
    id: string,
    changes: { title?: string; url?: string }
  ): Promise<void>
  deleteBookmark(id: string): Promise<void>
  deleteFolder(id: string): Promise<void>
}

function findNode(
  nodes: BookmarkNode[],
  id: string
): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    if (node.children) {
      const found = findNode(node.children, id)
      if (found) return found
    }
  }
  return null
}

export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  tree: [],
  rootFolderId: null,
  isLoading: true,
  adapter: null,
  rootFolder: null,

  async init(adapter: BrowserAdapter) {
    set({ adapter, isLoading: true })

    const tree = await adapter.bookmarks.getTree()

    // Load saved root folder preference
    const savedRootId = await adapter.storage.get<string>("rootFolderId")

    const rootFolder = savedRootId ? findNode(tree, savedRootId) : null

    set({
      tree,
      rootFolderId: savedRootId,
      rootFolder,
      isLoading: false,
    })

    // Subscribe to Chrome bookmark events (no-ops for standalone)
    const unsubscribers = [
      adapter.bookmarks.onChanged(() => get().refresh()),
      adapter.bookmarks.onCreated(() => get().refresh()),
      adapter.bookmarks.onRemoved(() => get().refresh()),
      adapter.bookmarks.onMoved(() => get().refresh()),
    ]

    // Store cleanup function (called if needed)
    return () => {
      for (const unsub of unsubscribers) {
        unsub()
      }
    }
  },

  setRootFolderId(id: string | null) {
    const { tree, adapter } = get()
    const rootFolder = id ? findNode(tree, id) : null
    set({ rootFolderId: id, rootFolder })
    adapter?.storage.set("rootFolderId", id)
  },

  async refresh() {
    const { adapter, rootFolderId } = get()
    if (!adapter) return

    const tree = await adapter.bookmarks.getTree()
    const rootFolder = rootFolderId
      ? findNode(tree, rootFolderId)
      : null

    set({ tree, rootFolder })
  },

  async createBookmark(parentId: string, title: string, url: string) {
    const { adapter } = get()
    if (!adapter) return
    await adapter.bookmarks.create({ parentId, title, url })
    await get().refresh()
  },

  async updateBookmark(
    id: string,
    changes: { title?: string; url?: string }
  ) {
    const { adapter } = get()
    if (!adapter) return
    await adapter.bookmarks.update(id, changes)
    await get().refresh()
  },

  async deleteBookmark(id: string) {
    const { adapter } = get()
    if (!adapter) return
    await adapter.bookmarks.remove(id)
    await get().refresh()
  },

  async deleteFolder(id: string) {
    const { adapter } = get()
    if (!adapter) return
    await adapter.bookmarks.removeTree(id)
    await get().refresh()
  },
}))
```

- [ ] **Step 2: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/stores/bookmark-store.ts
git commit -m "feat: add Zustand bookmark store"
```

---

## Task 12: Zustand stores — preferences and UI stores

**Files:**
- Create: `src/stores/preferences-store.ts`
- Create: `src/stores/ui-store.ts`

- [ ] **Step 1: Create the preferences store**

Create `src/stores/preferences-store.ts`:
```typescript
import { create } from "zustand"
import type { BrowserAdapter } from "@/browser"

type CardLayout = "list" | "grid"

interface PreferencesState {
  cardLayouts: Record<string, CardLayout>
  nestedFolders: boolean
  adapterMode: "browser" | "standalone"
  adapter: BrowserAdapter | null

  // Actions
  init(adapter: BrowserAdapter): Promise<void>
  setCardLayout(folderId: string, layout: CardLayout): void
  setNestedFolders(value: boolean): void
  setAdapterMode(mode: "browser" | "standalone"): void
}

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  cardLayouts: {},
  nestedFolders: false,
  adapterMode: "browser",
  adapter: null,

  async init(adapter: BrowserAdapter) {
    set({ adapter })

    const [cardLayouts, nestedFolders, adapterMode] = await Promise.all([
      adapter.storage.get<Record<string, CardLayout>>("cardLayouts"),
      adapter.storage.get<boolean>("nestedFolders"),
      adapter.storage.get<"browser" | "standalone">("adapterMode"),
    ])

    set({
      cardLayouts: cardLayouts ?? {},
      nestedFolders: nestedFolders ?? false,
      adapterMode: adapterMode ?? "browser",
    })
  },

  setCardLayout(folderId: string, layout: CardLayout) {
    const { cardLayouts, adapter } = get()
    const updated = { ...cardLayouts, [folderId]: layout }
    set({ cardLayouts: updated })
    adapter?.storage.set("cardLayouts", updated)
  },

  setNestedFolders(value: boolean) {
    set({ nestedFolders: value })
    get().adapter?.storage.set("nestedFolders", value)
  },

  setAdapterMode(mode: "browser" | "standalone") {
    set({ adapterMode: mode })
    get().adapter?.storage.set("adapterMode", mode)
  },
}))
```

- [ ] **Step 2: Create the UI store**

Create `src/stores/ui-store.ts`:
```typescript
import { create } from "zustand"
import type { BookmarkNode } from "@/browser"

interface DeletingItem {
  id: string
  title: string
  type: "bookmark" | "folder"
  childCount?: number
}

interface UIState {
  settingsOpen: boolean
  editingBookmark: BookmarkNode | null
  deletingItem: DeletingItem | null

  // Actions
  openSettings(): void
  closeSettings(): void
  openEditor(bookmark: BookmarkNode): void
  closeEditor(): void
  openDeleteConfirm(item: DeletingItem): void
  closeDeleteConfirm(): void
}

export const useUIStore = create<UIState>((set) => ({
  settingsOpen: false,
  editingBookmark: null,
  deletingItem: null,

  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openEditor: (bookmark) => set({ editingBookmark: bookmark }),
  closeEditor: () => set({ editingBookmark: null }),
  openDeleteConfirm: (item) => set({ deletingItem: item }),
  closeDeleteConfirm: () => set({ deletingItem: null }),
}))
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/stores/preferences-store.ts src/stores/ui-store.ts
git commit -m "feat: add preferences and UI Zustand stores"
```

---

## Task 13: Favicon component

**Files:**
- Create: `src/features/bookmark-item/favicon.tsx`

- [ ] **Step 1: Create the favicon component with fallback chain**

Create `src/features/bookmark-item/favicon.tsx`:
```typescript
import * as React from "react"
import { cn } from "@/lib/utils"

interface FaviconProps {
  url: string
  primarySrc: string
  fallbackSrc?: string
  title: string
  className?: string
  size?: number
}

export function Favicon({
  url,
  primarySrc,
  fallbackSrc,
  title,
  className,
  size = 20,
}: FaviconProps) {
  const [src, setSrc] = React.useState(primarySrc)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    setSrc(primarySrc)
    setFailed(false)
  }, [primarySrc])

  const handleError = React.useCallback(() => {
    if (!failed && fallbackSrc) {
      setSrc(fallbackSrc)
      setFailed(true)
    } else {
      setFailed(true)
    }
  }, [failed, fallbackSrc])

  if (failed && (!fallbackSrc || src === fallbackSrc)) {
    // Final fallback: first letter of domain
    let letter = "?"
    try {
      letter = new URL(url).hostname.charAt(0).toUpperCase()
    } catch {
      // keep "?"
    }

    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground",
          className
        )}
        style={{ width: size, height: size }}
        aria-label={title}
      >
        {letter}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      className={cn("shrink-0 rounded-sm", className)}
      onError={handleError}
      loading="lazy"
    />
  )
}
```

- [ ] **Step 2: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/features/bookmark-item/favicon.tsx
git commit -m "feat: add Favicon component with fallback chain"
```

---

## Task 14: BookmarkItem component

**Files:**
- Create: `src/features/bookmark-item/bookmark-item.tsx`
- Create: `src/features/bookmark-item/index.ts`

- [ ] **Step 1: Create the bookmark item component**

This component renders a single bookmark link with a hover card showing full details and actions.

Create `src/features/bookmark-item/bookmark-item.tsx`:
```typescript
import * as React from "react"
import { cn } from "@/lib/utils"
import { Favicon } from "./favicon"
import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  PencilEdit01Icon,
  Copy01Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons"
import type { BookmarkNode } from "@/browser"
import { useUIStore } from "@/stores/ui-store"

interface BookmarkItemProps {
  bookmark: BookmarkNode
  layout: "list" | "grid"
  faviconUrl: string
  faviconFallbackUrl?: string
}

export function BookmarkItem({
  bookmark,
  layout,
  faviconUrl,
  faviconFallbackUrl,
}: BookmarkItemProps) {
  const openEditor = useUIStore((s) => s.openEditor)
  const openDeleteConfirm = useUIStore((s) => s.openDeleteConfirm)

  const handleCopyUrl = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (bookmark.url) {
        navigator.clipboard.writeText(bookmark.url)
      }
    },
    [bookmark.url]
  )

  const handleEdit = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      openEditor(bookmark)
    },
    [bookmark, openEditor]
  )

  const handleDelete = React.useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      openDeleteConfirm({
        id: bookmark.id,
        title: bookmark.title,
        type: "bookmark",
      })
    },
    [bookmark, openDeleteConfirm]
  )

  if (layout === "grid") {
    return (
      <HoverCard>
        <HoverCardTrigger
          render={
            <a
              href={bookmark.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center rounded-lg p-2 transition-colors hover:bg-accent"
            />
          }
        >
          <Favicon
            url={bookmark.url ?? ""}
            primarySrc={faviconUrl}
            fallbackSrc={faviconFallbackUrl}
            title={bookmark.title}
            size={32}
          />
        </HoverCardTrigger>
        <HoverCardContent className="w-64">
          <HoverCardBody
            bookmark={bookmark}
            onEdit={handleEdit}
            onCopyUrl={handleCopyUrl}
            onDelete={handleDelete}
          />
        </HoverCardContent>
      </HoverCard>
    )
  }

  // List layout
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <a
            href={bookmark.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-accent"
          />
        }
      >
        <Favicon
          url={bookmark.url ?? ""}
          primarySrc={faviconUrl}
          fallbackSrc={faviconFallbackUrl}
          title={bookmark.title}
          size={16}
        />
        <span className="truncate text-sm">{bookmark.title}</span>
      </HoverCardTrigger>
      <HoverCardContent className="w-72">
        <HoverCardBody
          bookmark={bookmark}
          onEdit={handleEdit}
          onCopyUrl={handleCopyUrl}
          onDelete={handleDelete}
        />
      </HoverCardContent>
    </HoverCard>
  )
}

function HoverCardBody({
  bookmark,
  onEdit,
  onCopyUrl,
  onDelete,
}: {
  bookmark: BookmarkNode
  onEdit: (e: React.MouseEvent) => void
  onCopyUrl: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="font-medium text-sm">{bookmark.title}</div>
      {bookmark.url && (
        <div className="truncate text-xs text-muted-foreground">
          {bookmark.url}
        </div>
      )}
      <div className="flex items-center gap-1 pt-1">
        <Button variant="ghost" size="icon-sm" onClick={onEdit}>
          <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onCopyUrl}>
          <HugeiconsIcon icon={Copy01Icon} size={14} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onDelete}>
          <HugeiconsIcon icon={Delete02Icon} size={14} />
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create the index re-export**

Create `src/features/bookmark-item/index.ts`:
```typescript
export { BookmarkItem } from "./bookmark-item"
export { Favicon } from "./favicon"
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors. If Hugeicons icon imports fail, check available icons with: `grep -r "export" node_modules/@hugeicons/core-free-icons/dist/ | head -20` and use the correct names.

- [ ] **Step 4: Commit**

```bash
git add src/features/bookmark-item/
git commit -m "feat: add BookmarkItem component with hover card actions"
```

---

## Task 15: BookmarkCard component

**Files:**
- Create: `src/features/bookmark-card/bookmark-card.tsx`
- Create: `src/features/bookmark-card/index.ts`

- [ ] **Step 1: Create the bookmark card component**

Create `src/features/bookmark-card/bookmark-card.tsx`:
```typescript
import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import {
  GridViewIcon,
  Menu02Icon,
} from "@hugeicons/core-free-icons"
import { BookmarkItem } from "@/features/bookmark-item"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BookmarkNode } from "@/browser"

interface BookmarkCardProps {
  folder: BookmarkNode
  nested?: boolean
}

export function BookmarkCard({ folder, nested = false }: BookmarkCardProps) {
  const cardLayouts = usePreferencesStore((s) => s.cardLayouts)
  const setCardLayout = usePreferencesStore((s) => s.setCardLayout)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const adapter = useBookmarkStore((s) => s.adapter)

  const layout = cardLayouts[folder.id] ?? "list"
  const children = folder.children ?? []

  // Separate direct bookmarks from subfolders
  const bookmarks = children.filter((c) => c.url !== undefined)
  const subfolders = children.filter(
    (c) => c.url === undefined && c.children !== undefined
  )

  const toggleLayout = React.useCallback(() => {
    setCardLayout(folder.id, layout === "list" ? "grid" : "list")
  }, [folder.id, layout, setCardLayout])

  const getFaviconUrl = React.useCallback(
    (pageUrl: string) => {
      return adapter?.favicon.getUrl(pageUrl) ?? ""
    },
    [adapter]
  )

  // Get fallback URL (Google S2) when using Chrome adapter
  const getFallbackFaviconUrl = React.useCallback(
    (pageUrl: string) => {
      try {
        const domain = new URL(pageUrl).hostname
        return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`
      } catch {
        return undefined
      }
    },
    []
  )

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-card p-4 ring-1 ring-border",
        nested && "ring-border/50"
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3
          className={cn(
            "font-medium truncate",
            nested ? "text-xs" : "text-sm"
          )}
        >
          {folder.title}
        </h3>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleLayout}
          aria-label={`Switch to ${layout === "list" ? "grid" : "list"} view`}
        >
          <HugeiconsIcon
            icon={layout === "list" ? GridViewIcon : Menu02Icon}
            size={14}
          />
        </Button>
      </div>

      {/* Bookmarks */}
      {bookmarks.length > 0 && (
        <div
          className={cn(
            layout === "grid"
              ? "grid grid-cols-[repeat(auto-fill,minmax(40px,1fr))] gap-1"
              : "flex flex-col"
          )}
        >
          {bookmarks.map((bookmark) => (
            <BookmarkItem
              key={bookmark.id}
              bookmark={bookmark}
              layout={layout}
              faviconUrl={getFaviconUrl(bookmark.url!)}
              faviconFallbackUrl={getFallbackFaviconUrl(bookmark.url!)}
            />
          ))}
        </div>
      )}

      {/* Nested subfolders (only in nested mode) */}
      {nestedFolders &&
        subfolders.map((subfolder) => (
          <BookmarkCard key={subfolder.id} folder={subfolder} nested />
        ))}
    </div>
  )
}
```

- [ ] **Step 2: Create the index re-export**

Create `src/features/bookmark-card/index.ts`:
```typescript
export { BookmarkCard } from "./bookmark-card"
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors. If Hugeicons icon names don't match, search for the correct ones: `grep -ri "gridview\|grid_view\|grid-view" node_modules/@hugeicons/core-free-icons/dist/`.

- [ ] **Step 4: Commit**

```bash
git add src/features/bookmark-card/
git commit -m "feat: add BookmarkCard component with layout toggle and nesting"
```

---

## Task 16: BookmarkGrid component (masonry layout)

**Files:**
- Create: `src/features/bookmark-grid/bookmark-grid.tsx`
- Create: `src/features/bookmark-grid/index.ts`

- [ ] **Step 1: Create the bookmark grid component**

First, check `@masonry-grid/react` API:
```bash
cat node_modules/@masonry-grid/react/dist/index.d.mts | head -40
```

Then create `src/features/bookmark-grid/bookmark-grid.tsx` using the library's actual API. The expected usage pattern is:

```typescript
import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { BookmarkCard } from "@/features/bookmark-card"
import type { BookmarkNode } from "@/browser"

function collectAllFolders(node: BookmarkNode): BookmarkNode[] {
  const folders: BookmarkNode[] = []
  if (node.children) {
    for (const child of node.children) {
      if (child.url === undefined && child.children !== undefined) {
        folders.push(child)
        folders.push(...collectAllFolders(child))
      }
    }
  }
  return folders
}

export function BookmarkGrid() {
  const rootFolder = useBookmarkStore((s) => s.rootFolder)
  const tree = useBookmarkStore((s) => s.tree)
  const isLoading = useBookmarkStore((s) => s.isLoading)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)

  const displayRoot = rootFolder ?? (tree.length > 0 ? tree[0] : null)

  const folders = React.useMemo(() => {
    if (!displayRoot) return []

    if (nestedFolders) {
      // Only direct child folders
      return (displayRoot.children ?? []).filter(
        (c) => c.url === undefined && c.children !== undefined
      )
    }

    // Flat mode: all folders at any depth
    return collectAllFolders(displayRoot)
  }, [displayRoot, nestedFolders])

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        Loading bookmarks...
      </div>
    )
  }

  if (folders.length === 0) {
    return (
      <div className="flex items-center justify-center p-12 text-muted-foreground">
        No bookmark folders found.
      </div>
    )
  }

  // Use @masonry-grid/react — adapt to actual API after checking types in step above.
  // If the library uses MasonryGrid + Frame components:
  // <MasonryGrid><Frame>{...}</Frame></MasonryGrid>
  // If it uses a simpler API, adapt accordingly.
  // Fallback: use CSS columns if library API is incompatible.
  return (
    <div
      className="columns-1 gap-4 sm:columns-2 md:columns-3 lg:columns-4 xl:columns-5"
      style={{ columnFill: "balance" }}
    >
      {folders.map((folder) => (
        <div key={folder.id} className="mb-4 break-inside-avoid">
          <BookmarkCard folder={folder} />
        </div>
      ))}
    </div>
  )
}
```

**Important:** The implementation above uses CSS columns as a safe baseline. After checking the actual `@masonry-grid/react` API in step 1, replace the CSS columns with the library's components. If the library's API doesn't fit well, CSS columns are a perfectly acceptable fallback.

- [ ] **Step 2: Create the index re-export**

Create `src/features/bookmark-grid/index.ts`:
```typescript
export { BookmarkGrid } from "./bookmark-grid"
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/bookmark-grid/
git commit -m "feat: add BookmarkGrid masonry layout component"
```

---

## Task 17: Settings dialog

**Files:**
- Create: `src/features/settings/root-folder-picker.tsx`
- Create: `src/features/settings/settings-dialog.tsx`
- Create: `src/features/settings/index.ts`

- [ ] **Step 1: Create the root folder picker**

Create `src/features/settings/root-folder-picker.tsx`:
```typescript
import * as React from "react"
import { useBookmarkStore } from "@/stores/bookmark-store"
import type { BookmarkNode } from "@/browser"

interface RootFolderPickerProps {
  value: string | null
  onChange: (id: string | null) => void
}

function collectFolderPaths(
  node: BookmarkNode,
  path: string[] = []
): { id: string; label: string }[] {
  const currentPath = node.title ? [...path, node.title] : path
  const result: { id: string; label: string }[] = []

  if (node.title) {
    result.push({
      id: node.id,
      label: currentPath.join(" > "),
    })
  }

  if (node.children) {
    for (const child of node.children) {
      if (child.url === undefined) {
        result.push(...collectFolderPaths(child, currentPath))
      }
    }
  }

  return result
}

export function RootFolderPicker({ value, onChange }: RootFolderPickerProps) {
  const tree = useBookmarkStore((s) => s.tree)

  const folders = React.useMemo(() => {
    const all: { id: string; label: string }[] = []
    for (const root of tree) {
      all.push(...collectFolderPaths(root))
    }
    return all
  }, [tree])

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium">Root Folder</label>
      <select
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
      >
        <option value="">Browser Root (all bookmarks)</option>
        {folders.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Choose which folder to display as the root of your bookmarks.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Create the settings dialog**

Create `src/features/settings/settings-dialog.tsx`:
```typescript
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { useUIStore } from "@/stores/ui-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useTheme } from "@/components/theme-provider"
import { RootFolderPicker } from "./root-folder-picker"
import { serializeNetscapeBookmarks } from "@/browser/import-export/netscape-serializer"
import { parseNetscapeBookmarks } from "@/browser/import-export/netscape-parser"
import type { BookmarkNode } from "@/browser"

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const nestedFolders = usePreferencesStore((s) => s.nestedFolders)
  const setNestedFolders = usePreferencesStore((s) => s.setNestedFolders)
  const rootFolderId = useBookmarkStore((s) => s.rootFolderId)
  const setRootFolderId = useBookmarkStore((s) => s.setRootFolderId)
  const tree = useBookmarkStore((s) => s.tree)
  const adapter = useBookmarkStore((s) => s.adapter)
  const refresh = useBookmarkStore((s) => s.refresh)
  const { theme, setTheme } = useTheme()

  const handleExport = () => {
    const html = serializeNetscapeBookmarks(tree)
    const blob = new Blob([html], { type: "text/html" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "bookmarks.html"
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleImport = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".html,.htm"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file || !adapter) return

      const text = await file.text()
      const imported = parseNetscapeBookmarks(text)

      // Write imported bookmarks to adapter
      async function writeNode(
        node: BookmarkNode,
        parentId: string
      ): Promise<void> {
        if (node.url) {
          await adapter!.bookmarks.create({
            parentId,
            title: node.title,
            url: node.url,
          })
        } else if (node.children) {
          const folder = await adapter!.bookmarks.create({
            parentId,
            title: node.title,
          })
          for (const child of node.children) {
            await writeNode(child, folder.id)
          }
        }
      }

      // Import into root
      const rootId = rootFolderId ?? "0"
      for (const root of imported) {
        if (root.children) {
          for (const child of root.children) {
            await writeNode(child, rootId)
          }
        }
      }

      await refresh()
    }
    input.click()
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeSettings()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your bookmarks dashboard.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-6">
          {/* Root folder */}
          <RootFolderPicker value={rootFolderId} onChange={setRootFolderId} />

          {/* Nested folders toggle */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <Label className="text-sm font-medium">Nested Folders</Label>
              <p className="text-xs text-muted-foreground">
                Show subfolders inside their parent cards.
              </p>
            </div>
            <Switch
              checked={nestedFolders}
              onCheckedChange={(checked) => setNestedFolders(checked)}
            />
          </div>

          {/* Theme */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">Theme</Label>
            <div className="flex gap-2">
              {(["light", "dark", "system"] as const).map((t) => (
                <Button
                  key={t}
                  variant={theme === t ? "default" : "outline"}
                  size="sm"
                  onClick={() => setTheme(t)}
                  className="capitalize"
                >
                  {t}
                </Button>
              ))}
            </div>
          </div>

          {/* Import/Export */}
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium">Bookmarks Data</Label>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleImport}>
                Import
              </Button>
              <Button variant="outline" size="sm" onClick={handleExport}>
                Export
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Import or export bookmarks as HTML (standard browser format).
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Create the index re-export**

Create `src/features/settings/index.ts`:
```typescript
export { SettingsDialog } from "./settings-dialog"
```

- [ ] **Step 4: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors. If `Switch` component doesn't support `onCheckedChange`, check the actual shadcn Switch API in `src/components/ui/switch.tsx` and adapt.

- [ ] **Step 5: Commit**

```bash
git add src/features/settings/
git commit -m "feat: add settings dialog with root folder, theme, and import/export"
```

---

## Task 18: Bookmark editor dialog

**Files:**
- Create: `src/features/bookmark-editor/bookmark-editor-dialog.tsx`
- Create: `src/features/bookmark-editor/index.ts`

- [ ] **Step 1: Create the bookmark editor dialog**

Create `src/features/bookmark-editor/bookmark-editor-dialog.tsx`:
```typescript
import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useUIStore } from "@/stores/ui-store"
import { useBookmarkStore } from "@/stores/bookmark-store"

export function BookmarkEditorDialog() {
  const editingBookmark = useUIStore((s) => s.editingBookmark)
  const closeEditor = useUIStore((s) => s.closeEditor)
  const updateBookmark = useBookmarkStore((s) => s.updateBookmark)

  const [title, setTitle] = React.useState("")
  const [url, setUrl] = React.useState("")

  const isFolder = editingBookmark ? editingBookmark.url === undefined : false

  React.useEffect(() => {
    if (editingBookmark) {
      setTitle(editingBookmark.title)
      setUrl(editingBookmark.url ?? "")
    }
  }, [editingBookmark])

  const handleSave = async () => {
    if (!editingBookmark) return

    const changes: { title?: string; url?: string } = {}
    if (title !== editingBookmark.title) changes.title = title
    if (!isFolder && url !== editingBookmark.url) changes.url = url

    if (Object.keys(changes).length > 0) {
      await updateBookmark(editingBookmark.id, changes)
    }
    closeEditor()
  }

  return (
    <Dialog
      open={editingBookmark !== null}
      onOpenChange={(o) => !o && closeEditor()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {isFolder ? "Edit Folder" : "Edit Bookmark"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="bookmark-title">Title</Label>
            <Input
              id="bookmark-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Bookmark title"
            />
          </div>

          {!isFolder && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="bookmark-url">URL</Label>
              <Input
                id="bookmark-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={closeEditor}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create the index re-export**

Create `src/features/bookmark-editor/index.ts`:
```typescript
export { BookmarkEditorDialog } from "./bookmark-editor-dialog"
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/bookmark-editor/
git commit -m "feat: add bookmark editor dialog for titles and URLs"
```

---

## Task 19: Delete confirmation dialog

**Files:**
- Create: `src/features/delete-confirm/delete-confirm-dialog.tsx`
- Create: `src/features/delete-confirm/index.ts`

- [ ] **Step 1: Create the delete confirmation dialog**

Create `src/features/delete-confirm/delete-confirm-dialog.tsx`:
```typescript
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { useUIStore } from "@/stores/ui-store"
import { useBookmarkStore } from "@/stores/bookmark-store"

export function DeleteConfirmDialog() {
  const deletingItem = useUIStore((s) => s.deletingItem)
  const closeDeleteConfirm = useUIStore((s) => s.closeDeleteConfirm)
  const deleteBookmark = useBookmarkStore((s) => s.deleteBookmark)
  const deleteFolder = useBookmarkStore((s) => s.deleteFolder)

  const handleConfirm = async () => {
    if (!deletingItem) return

    if (deletingItem.type === "folder") {
      await deleteFolder(deletingItem.id)
    } else {
      await deleteBookmark(deletingItem.id)
    }
    closeDeleteConfirm()
  }

  return (
    <Dialog
      open={deletingItem !== null}
      onOpenChange={(o) => !o && closeDeleteConfirm()}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete {deletingItem?.type === "folder" ? "Folder" : "Bookmark"}
          </DialogTitle>
          <DialogDescription>
            {deletingItem?.type === "folder" ? (
              <>
                Are you sure you want to delete the folder{" "}
                <strong>{deletingItem.title}</strong> and all its contents?
                This action cannot be undone.
              </>
            ) : (
              <>
                Are you sure you want to delete{" "}
                <strong>{deletingItem?.title}</strong>? This action cannot be
                undone.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={closeDeleteConfirm}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Create the index re-export**

Create `src/features/delete-confirm/index.ts`:
```typescript
export { DeleteConfirmDialog } from "./delete-confirm-dialog"
```

- [ ] **Step 3: Verify typecheck passes**

Run:
```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/features/delete-confirm/
git commit -m "feat: add delete confirmation dialog"
```

---

## Task 20: App.tsx — wire everything together

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace the placeholder App component**

Replace the entire contents of `src/App.tsx`:
```typescript
import * as React from "react"
import { detectAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"
import { BookmarkGrid } from "@/features/bookmark-grid"
import { SettingsDialog } from "@/features/settings"
import { BookmarkEditorDialog } from "@/features/bookmark-editor"
import { DeleteConfirmDialog } from "@/features/delete-confirm"
import { Button } from "@/components/ui/button"
import { HugeiconsIcon } from "@hugeicons/react"
import { Settings02Icon } from "@hugeicons/core-free-icons"

export function App() {
  const initBookmarks = useBookmarkStore((s) => s.init)
  const initPreferences = usePreferencesStore((s) => s.init)
  const openSettings = useUIStore((s) => s.openSettings)
  const isLoading = useBookmarkStore((s) => s.isLoading)

  React.useEffect(() => {
    async function bootstrap() {
      const adapter = await detectAdapter()
      await Promise.all([initBookmarks(adapter), initPreferences(adapter)])
    }
    bootstrap()
  }, [initBookmarks, initPreferences])

  return (
    <div className="min-h-svh bg-background text-foreground">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center justify-end p-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={openSettings}
          aria-label="Settings"
        >
          <HugeiconsIcon icon={Settings02Icon} size={18} />
        </Button>
      </header>

      {/* Main content */}
      <main className="px-4 pb-8">
        {isLoading ? (
          <div className="flex items-center justify-center p-12 text-muted-foreground">
            Loading bookmarks...
          </div>
        ) : (
          <BookmarkGrid />
        )}
      </main>

      {/* Dialogs */}
      <SettingsDialog />
      <BookmarkEditorDialog />
      <DeleteConfirmDialog />
    </div>
  )
}

export default App
```

- [ ] **Step 2: Verify the app builds**

Run:
```bash
bun run build
```
Expected: Build succeeds. If there are import errors, fix them (most likely icon names or component prop mismatches).

- [ ] **Step 3: Verify the app runs in dev mode**

Run:
```bash
bun dev
```
Expected: Opens in browser, standalone adapter loads, seed data renders as folder cards in a masonry layout. You should see Quick Access, Development, AI, Design, and Productivity folders.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire up App with adapter bootstrap, grid, and dialogs"
```

---

## Task 21: Chrome extension manifest

**Files:**
- Create: `public/manifest.json`
- Create: `public/icons/` (placeholder icons)

- [ ] **Step 1: Create the manifest**

Create `public/manifest.json`:
```json
{
  "manifest_version": 3,
  "name": "Bookmarks - But Better",
  "description": "A clean bookmarks dashboard for your new tab page",
  "version": "0.0.1",
  "chrome_url_overrides": {
    "newtab": "index.html"
  },
  "permissions": [
    "bookmarks",
    "storage",
    "favicon"
  ],
  "icons": {
    "16": "icons/icon-16.png",
    "48": "icons/icon-48.png",
    "128": "icons/icon-128.png"
  }
}
```

- [ ] **Step 2: Create placeholder extension icons**

Create simple placeholder PNG icons. For now, generate 1x1 colored PNGs as placeholders (the actual icons can be designed later):

```bash
mkdir -p public/icons
# Create minimal placeholder PNGs (these should be replaced with real icons later)
convert -size 16x16 xc:'#6366f1' public/icons/icon-16.png 2>/dev/null || echo "Install imagemagick or create icons manually"
convert -size 48x48 xc:'#6366f1' public/icons/icon-48.png 2>/dev/null || echo "Install imagemagick or create icons manually"
convert -size 128x128 xc:'#6366f1' public/icons/icon-128.png 2>/dev/null || echo "Install imagemagick or create icons manually"
```

If `convert` is not available, skip the icon creation — the extension will work without icons, they're just cosmetic.

- [ ] **Step 3: Build and verify manifest is in dist**

Run:
```bash
bun run build && ls dist/manifest.json
```
Expected: `dist/manifest.json` exists.

- [ ] **Step 4: Commit**

```bash
git add public/manifest.json public/icons/
git commit -m "feat: add Chrome MV3 manifest and placeholder icons"
```

---

## Task 22: Final integration verification

- [ ] **Step 1: Run typecheck**

```bash
bun run typecheck
```
Expected: No errors.

- [ ] **Step 2: Run lint**

```bash
bun run lint
```
Expected: No errors (or only pre-existing warnings).

- [ ] **Step 3: Run build**

```bash
bun run build
```
Expected: Builds successfully.

- [ ] **Step 4: Run dev and manually verify**

```bash
bun dev
```

Verify in browser:
- Masonry grid of folder cards renders with seed data
- Each card shows folder title and layout toggle (grid/list)
- Clicking the toggle switches between list and grid view
- Hovering a bookmark shows the hover card with title, URL, and action buttons
- Settings dialog opens and shows root folder picker, nested toggle, theme, import/export
- Edit dialog opens from hover card edit button
- Delete confirm dialog opens from hover card delete button
- Theme switching works

- [ ] **Step 5: Commit any fixes**

If any fixes were needed during verification:
```bash
git add -A
git commit -m "fix: integration fixes from manual verification"
```
