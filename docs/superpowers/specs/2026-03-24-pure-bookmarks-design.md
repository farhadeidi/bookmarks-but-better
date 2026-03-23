# Pure Bookmarks - Design Specification

## Overview

Pure Bookmarks is a Chrome extension that replaces the new tab page with a clean bookmarks dashboard. It reads the user's browser bookmarks and displays them in a masonry grid of folder cards, each with its own layout mode. It also supports a standalone mode backed by IndexedDB, with import/export via the standard Netscape Bookmark HTML format.

## Architecture

### Layered approach

The system uses a multi-store Zustand architecture with a browser adapter abstraction layer. All browser-specific code lives behind adapter interfaces so Chrome, Firefox, and standalone implementations are interchangeable.

```
UI Components (features/)
        ↓ reads/writes
Zustand Stores (stores/)
        ↓ calls
Browser Adapters (browser/)
        ↓ wraps
Chrome APIs / IndexedDB
```

Features are compositional UI components that may nest each other (e.g., `bookmark-grid` renders `bookmark-card` which renders `bookmark-item`). This is natural parent-child composition, not cross-feature coupling. The isolation rule applies to stores and the browser layer — they do not import each other.

## Project Structure

```
src/
├── browser/                    # Browser abstraction layer
│   ├── types.ts                # Adapter interfaces
│   ├── chrome/                 # Chrome implementation
│   │   ├── bookmarks.ts
│   │   ├── storage.ts
│   │   └── favicon.ts
│   ├── standalone/             # Standalone implementation (IndexedDB)
│   │   ├── bookmarks.ts
│   │   ├── storage.ts
│   │   └── favicon.ts
│   ├── favicon/                # Favicon provider system
│   │   ├── types.ts
│   │   ├── chrome-favicon.ts
│   │   └── google-favicon.ts
│   ├── import-export/          # Bookmark import/export
│   │   ├── netscape-parser.ts
│   │   └── netscape-serializer.ts
│   ├── detect.ts               # Environment detection, returns correct adapter
│   └── index.ts                # Re-exports active adapter
├── stores/                     # Zustand stores
│   ├── bookmark-store.ts
│   ├── preferences-store.ts
│   └── ui-store.ts
├── features/                   # Feature components (compositional)
│   ├── bookmark-grid/          # Masonry grid of folder cards
│   ├── bookmark-card/          # Individual folder card
│   ├── bookmark-item/          # Single bookmark (link) within a card
│   ├── settings/               # Settings dialog
│   └── bookmark-editor/        # Edit bookmark/folder dialog
├── components/                 # Shared/generic components
│   └── ui/                     # shadcn + Base UI components
├── hooks/                      # Shared hooks
├── lib/                        # Utilities
├── types/                      # Shared type definitions
├── App.tsx
├── main.tsx
└── index.css

public/
├── manifest.json               # Chrome MV3 manifest
├── icons/                      # Extension icons (16, 48, 128)
└── vite.svg

dev/
└── seed-bookmarks.json         # Sample bookmark data for dev/standalone mode
```

## Browser Adapter Layer

### Interfaces

```typescript
// browser/types.ts

interface BookmarkNode {
  id: string
  title: string
  url?: string           // undefined for folders
  parentId?: string
  children?: BookmarkNode[]
  dateAdded?: number
}

interface BookmarkAdapter {
  getTree(): Promise<BookmarkNode[]>
  getSubTree(id: string): Promise<BookmarkNode[]>
  create(bookmark: { parentId: string; title: string; url?: string }): Promise<BookmarkNode>
  update(id: string, changes: { title?: string; url?: string }): Promise<BookmarkNode>
  remove(id: string): Promise<void>
  removeTree(id: string): Promise<void>
  onChanged(callback: () => void): () => void
  onCreated(callback: () => void): () => void
  onRemoved(callback: () => void): () => void
  onMoved(callback: () => void): () => void
}

interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T): Promise<void>
  remove(key: string): Promise<void>
}

interface FaviconProvider {
  getUrl(pageUrl: string): string
  isAvailable(): boolean
}

interface BrowserAdapter {
  bookmarks: BookmarkAdapter
  storage: StorageAdapter
  favicon: FaviconProvider
}
```

### Implementations

**Chrome adapter:**
- `bookmarks.ts` wraps `chrome.bookmarks.*` API
- `storage.ts` wraps `chrome.storage.sync`
- `favicon.ts` chains Chrome's `chrome://favicon` API with Google S2 fallback

**Standalone adapter:**
- `bookmarks.ts` stores the bookmark tree in IndexedDB with `parentId` references (same shape as Chrome's API)
- `storage.ts` stores preferences in IndexedDB
- `favicon.ts` uses Google S2 favicon service directly

**Adapter detection (`detect.ts`):**
1. Check user preference stored in IndexedDB (accessible before adapter loads) — if user explicitly chose standalone, use it
2. If no preference: check if `chrome.bookmarks` API exists — use Chrome adapter
3. Otherwise — use standalone adapter

### Favicon Provider System

Pluggable chain of providers with fallback:

- `chrome-favicon.ts` — returns `chrome://favicon/size/16@2x/${url}`. Available only in Chrome extension context.
- `google-favicon.ts` — returns `https://www.google.com/s2/favicons?domain=${domain}&sz=32`. Always available.

Resolution:
- Chrome adapter: try Chrome provider, on image load error fall back to Google
- Standalone adapter: uses Google provider directly
- Final fallback in the UI: generic globe icon or first letter of the domain

Each provider is independently usable and testable. New providers (DuckDuckGo, self-hosted) can be added by implementing `FaviconProvider`.

### Import/Export

Standard Netscape Bookmark HTML format support:

- **Import (`netscape-parser.ts`):** parse the HTML `<DT>/<DL>` structure into a `BookmarkNode` tree, write to the active adapter
- **Export (`netscape-serializer.ts`):** read tree from adapter, serialize to Netscape HTML
- Accessible from the settings dialog: import available in standalone mode, export available in all modes

## State Management

Three Zustand stores, each with a single responsibility. Stores do not import each other.

### `bookmark-store.ts`

Owns the bookmark tree data.

- `tree: BookmarkNode[]` — full tree from the active adapter
- `rootFolderId: string | null` — user's selected root folder
- `rootFolder: BookmarkNode | null` — derived subtree from rootFolderId
- `loadTree()` — fetches from adapter, subscribes to change events (onChanged, onCreated, onRemoved, onMoved)
- `refresh()` — re-fetches after mutations
- `createBookmark(parentId, title, url)` — calls adapter, then refreshes
- `updateBookmark(id, changes)` — calls adapter, then refreshes
- `deleteBookmark(id)` — calls adapter.remove(), then refreshes
- `deleteFolder(id)` — calls adapter.removeTree(), then refreshes

### `preferences-store.ts`

User settings, persisted via the StorageAdapter.

- `cardLayouts: Record<string, 'list' | 'grid'>` — per-folder layout choice
- `nestedFolders: boolean` — nested vs flat mode
- `adapterMode: 'browser' | 'standalone'` — which adapter to use
- `setCardLayout(folderId, layout)` — updates and persists
- `setNestedFolders(value)` — updates and persists
- Hydrates from storage on init, writes back on every change

### `ui-store.ts`

Transient UI state. Not persisted.

- `settingsOpen: boolean`
- `editingBookmark: BookmarkNode | null` — drives the edit dialog
- `deletingItem: { id: string; type: 'bookmark' | 'folder' } | null` — drives the confirm dialog
- Actions to open/close each dialog

## Feature Components

### `App.tsx`

Top-level layout. On mount: initializes bookmark store (loads tree, subscribes to changes), hydrates preferences store. Renders `BookmarkGrid` + settings button + dialogs (edit, delete confirm, settings).

### `bookmark-grid/`

The masonry page.

- Reads `rootFolder` from bookmark store, `nestedFolders` from preferences store
- **Flat mode:** collects all folders in the tree at any depth into a flat list, renders each as a `BookmarkCard` in the masonry grid
- **Nested mode:** renders only the direct child folders of the root as `BookmarkCard` components
- Uses `@masonry-grid/react` with responsive column breakpoints

### `bookmark-card/`

A single folder card.

- Header: folder title + layout toggle icon (grid/list)
- Body depends on layout mode:
  - **List:** favicon + truncated title per bookmark, vertical stack
  - **Grid:** favicon-only grid (like "Quick Access" cards in previous version)
- In nested mode: renders direct bookmarks first at the top, then nested `BookmarkCard` components for child folders recursively. Each nested card has its own layout toggle and full functionality.
- Layout preference stored per-folder via preferences store

### `bookmark-item/`

A single bookmark link.

- Renders favicon + title (list mode) or just favicon (grid mode)
- Click opens the URL
- Hover shows a hover card with:
  - Full bookmark title
  - URL preview
  - Edit button (opens edit dialog)
  - Copy URL button
  - Delete button (opens confirm dialog)

### `settings/`

Settings dialog (modal).

- Root folder picker (dropdown/tree showing the folder hierarchy)
- Nested folders toggle
- Adapter mode selector (browser bookmarks vs standalone)
- Import/export buttons (import in standalone mode, export in all modes)
- Theme picker

### `bookmark-editor/`

Edit dialog (modal).

- Title input field
- URL input field (for bookmarks) or just title (for folders)
- Save calls `updateBookmark()` on the bookmark store

### Delete confirmation

- Driven by `ui-store.deletingItem`
- Always shown before any delete operation
- Shows what is being deleted
- Warns about children being deleted for folder deletions
- Confirm calls `deleteBookmark()` or `deleteFolder()` on the bookmark store

## Chrome Extension Setup

### Manifest V3 (`public/manifest.json`)

- `manifest_version: 3`
- `chrome_url_overrides: { newtab: "index.html" }` — replaces the new tab page
- `permissions: ["bookmarks", "storage", "favicon"]`
- Standard metadata: name, description, version, icons (16, 48, 128)

### Build & Dev Workflow

- `bun dev` — runs the app in the browser, standalone adapter with seed data, fast iteration
- `bun run build` — produces a loadable Chrome extension in `dist/` with manifest and icons
- Vite copies `public/manifest.json` and icons to `dist/` automatically
- Extension testing: `bun run build` → load `dist/` as unpacked extension in Chrome

## UI Stack

- **shadcn** — styled component library (already initialized)
- **Base UI (`@base-ui/react`)** — unstyled primitives for low-level control
- **Tailwind CSS v4** — utility-first styling
- **@masonry-grid/react** — masonry layout
- **Zustand** — state management

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Target browser | Chrome MV3 | Primary target, adapter-ready for Firefox |
| State management | Zustand (3 stores) | Focused stores, no cross-imports, testable |
| Masonry layout | `@masonry-grid/react` | 1.4KB, modern CSS Grid, actively maintained |
| Favicons | Pluggable chain | Chrome API first, Google fallback, individually workable |
| Preferences storage | `chrome.storage.sync` / IndexedDB | Syncs across devices in Chrome, IndexedDB for standalone |
| Standalone mode | IndexedDB + import/export | Enables dev workflow and standalone product use |
| Bookmark actions | Hover card | Full title, edit, copy, delete — no right-click override |
| Edit UI | Dialog/modal | Consistent with settings and delete confirm patterns |
| Delete | Always confirm | Dialog before every delete operation |
| Folder views | Flat + nested | Flat: all folders top-level. Nested: recursive cards with root links first |
| UI framework | shadcn + Base UI + Tailwind | Styled components + unstyled primitives, already set up |
| Extension manifest | `public/manifest.json` | Vite auto-copies to dist |

## Future Considerations

The standalone adapter is designed for extensibility. Because it implements the same `BookmarkAdapter` interface, future additions can be layered in without touching Chrome adapter or UI code:

- Optional custom fields on bookmarks (tags, notes, priority)
- Backend sync (cloud storage, self-hosted)
- Additional browser adapters (Firefox, Safari)
- Additional favicon providers
- Search/filter functionality
- Drag-and-drop reordering
