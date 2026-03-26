# Folder Actions & Layout Settings — Design Spec

**Date:** 2026-03-26
**Scope:** GitHub issues #2 (folder rename), #6 (customizable grid columns), plus folder delete and container width control.

---

## 1. Folder Actions — Overflow Menu

### Problem

Folders displayed as cards on the dashboard have no management actions. Individual bookmarks have edit, delete, copy URL, and "view in manager" via hover cards, but folder cards only show a list/grid toggle. Users cannot rename or delete folders without going to Chrome's bookmark manager.

### Solution

Add a three-dot overflow menu (`⋯`) to each `BookmarkCard` header, positioned to the left of the existing list/grid toggle button.

### Menu Items

| Item              | Action                                                                 |
| ----------------- | ---------------------------------------------------------------------- |
| **Rename**        | Calls `useUIStore.openEditor(folder)` → opens `BookmarkEditorDialog`   |
| **View in manager** | Calls `adapter.bookmarks.openInManager(folder.id)`                  |
| **Delete**        | Calls `useUIStore.openDeleteConfirm({ id, title, type: "folder", childCount })` → opens `DeleteConfirmDialog` |

Delete is visually separated from the other items with a divider and styled in a destructive color.

### What Already Exists

- `BookmarkEditorDialog` already detects folders (`url === undefined`) and hides the URL field — no changes needed.
- `DeleteConfirmDialog` already supports `type: "folder"` and shows a warning about deleting all contents — no changes needed.
- `useBookmarkStore.deleteFolder(id)` calls `adapter.bookmarks.removeTree(id)` — no changes needed.

### Components Touched

- **`bookmark-card.tsx`** — Add a `DropdownMenu` (shadcn) with three menu items in the card header. Import `DropdownMenu`, `DropdownMenuTrigger`, `DropdownMenuContent`, `DropdownMenuItem`, `DropdownMenuSeparator` from shadcn. Import `useUIStore` and wire up actions.

### Components NOT Touched

- `BookmarkEditorDialog` — already handles folders
- `DeleteConfirmDialog` — already handles folders
- `bookmark-store.ts` — `deleteFolder()` and `updateBookmark()` already exist
- `ui-store.ts` — `openEditor()` and `openDeleteConfirm()` already exist

---

## 2. Grid Layout Settings

### Problem

The dashboard grid uses fixed responsive breakpoints (`columns-1 sm:columns-2 md:columns-3 lg:columns-4`). Users on wide monitors may want fewer columns (less stretched cards) or more columns (denser layout). There is no way to control this.

### Solution

Two new user preferences:

#### 2a. Max Columns

- **Key:** `maxColumns`
- **Type:** `number`
- **Values:** 2, 3, 4, 5, 6
- **Default:** 4 (matches current behavior)
- **Behavior:** The responsive breakpoints still apply (1 column on mobile, scaling up), but the column count is capped at `maxColumns`. For example, `maxColumns: 3` produces classes equivalent to `columns-1 sm:columns-2 md:columns-3` — the `lg:columns-4` breakpoint is not applied.
- **Implementation:** Build column classes dynamically in `bookmark-grid.tsx` based on the `maxColumns` value instead of a static class string. Map each column count to its responsive breakpoint:
  - 1 → `columns-1` (always applied as base)
  - 2 → `sm:columns-2`
  - 3 → `md:columns-3`
  - 4 → `lg:columns-4`
  - 5 → `xl:columns-5`
  - 6 → `2xl:columns-6`

#### 2b. Container Mode

- **Key:** `containerMode`
- **Type:** `"fluid" | "contained"`
- **Default:** `"fluid"`
- **Behavior:**
  - `"fluid"` — No max-width constraint. Grid fills available width (current behavior).
  - `"contained"` — Grid wrapper gets `max-w-[1440px] mx-auto`, centering the content and capping width.
- **Implementation:** Apply the container constraint on the outermost `<div>` in `bookmark-grid.tsx`, wrapping the columns grid, conditional on `containerMode`.

### Persistence

Both preferences are stored via the existing adapter storage pattern in `preferences-store.ts`, matching the approach used by `cardLayouts`, `nestedFolders`, and `colorTheme`.

---

## 3. Settings Dialog — Layout Section

### Current Structure

1. Root Folder picker
2. Nested Folders toggle
3. Import / Export

### New Structure

1. **Bookmarks** (implicit, no heading needed — it's the first section)
   - Root Folder picker
   - Nested Folders toggle
2. **Layout** (section heading + divider)
   - Max Columns — shadcn `Select` with options: 2, 3, 4, 5, 6. Description: "Maximum number of columns in the dashboard grid. Fewer columns on smaller screens."
   - Container — shadcn `Select` with options: Fluid, Contained. Description: "Contained limits the dashboard to 1440px wide and centers it."
3. **Data** (section heading + divider)
   - Import bookmarks
   - Export bookmarks

### UI Components

- Section headings: small uppercase label text (e.g., `text-xs font-medium uppercase tracking-wide text-muted-foreground`)
- Selects: shadcn `Select` component (already used for root folder picker)
- Descriptions below each control in muted text

---

## 4. Store Changes

### `preferences-store.ts`

New state fields:

```typescript
maxColumns: number          // 2 | 3 | 4 | 5 | 6, default: 4
containerMode: "fluid" | "contained"  // default: "fluid"
```

New actions:

```typescript
setMaxColumns(value: number): void
setContainerMode(mode: "fluid" | "contained"): void
```

Both follow the existing pattern: update state, persist via `adapter.storage.set()`.

Init loads both from storage with defaults:

```typescript
const maxColumns = await adapter.storage.get<number>("maxColumns")
const containerMode = await adapter.storage.get<"fluid" | "contained">("containerMode")

set({
  maxColumns: maxColumns ?? 4,
  containerMode: containerMode ?? "fluid",
})
```

---

## 5. Out of Scope

- Drag and drop bookmark sorting (#4)
- UI refinements and visual polish (#5)
- Onboarding wizard changes (layout settings are not part of first-run setup)
- Fixed column mode (no responsive breakpoints) — may revisit later
- Custom max-width values for contained mode
- Per-breakpoint column configuration
