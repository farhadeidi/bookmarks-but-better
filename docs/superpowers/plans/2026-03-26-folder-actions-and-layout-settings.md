# Folder Actions & Layout Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a three-dot overflow menu to folder cards (rename, view in manager, delete) and user-configurable grid layout settings (max columns, fluid/contained container).

**Architecture:** Folder actions wire new UI triggers in `BookmarkCard` to existing store actions and dialogs — no new stores or dialogs needed. Layout settings add two new preferences to the Zustand preferences store, a new "Layout" section in the Settings dialog, and dynamic class generation in the grid component.

**Tech Stack:** React 19, TypeScript, Zustand, shadcn (DropdownMenu, Select), Tailwind CSS v4, @hugeicons/react

---

### Task 1: Add overflow menu to BookmarkCard

**Files:**
- Modify: `src/features/bookmark-card/bookmark-card.tsx`

- [ ] **Step 1: Add imports for DropdownMenu, icons, and UI store**

Add these imports to the top of `bookmark-card.tsx`:

```typescript
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu"
import {
  MoreHorizontalIcon,
  PencilEdit01Icon,
  Delete02Icon,
  ArrowUpRight01Icon,
} from "@hugeicons/core-free-icons"
import { useUIStore } from "@/stores/ui-store"
```

- [ ] **Step 2: Wire up store actions inside the BookmarkCard component**

Add these lines inside `BookmarkCard`, after the existing `const adapter = ...` line:

```typescript
const openEditor = useUIStore((s) => s.openEditor)
const openDeleteConfirm = useUIStore((s) => s.openDeleteConfirm)
```

- [ ] **Step 3: Add the overflow menu to the card header**

Replace the existing `{/* Header */}` section (the `<div className="flex items-center justify-between">` block) with:

```tsx
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
  <div className="flex items-center gap-0.5">
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Folder actions"
          />
        }
      >
        <HugeiconsIcon icon={MoreHorizontalIcon} size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onClick={() => openEditor(folder)}
        >
          <HugeiconsIcon icon={PencilEdit01Icon} size={14} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => adapter?.bookmarks.openInManager(folder.id)}
        >
          <HugeiconsIcon icon={ArrowUpRight01Icon} size={14} />
          View in manager
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() =>
            openDeleteConfirm({
              id: folder.id,
              title: folder.title,
              type: "folder",
              childCount: (folder.children ?? []).length,
            })
          }
        >
          <HugeiconsIcon icon={Delete02Icon} size={14} />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={toggleLayout}
            aria-label={`Switch to ${layout === "list" ? "grid" : "list"} view`}
          />
        }
      >
        <HugeiconsIcon
          icon={layout === "list" ? GridViewIcon : Menu02Icon}
          size={14}
        />
      </TooltipTrigger>
      <TooltipContent>
        {layout === "list" ? "Grid view" : "List view"}
      </TooltipContent>
    </Tooltip>
  </div>
</div>
```

- [ ] **Step 4: Verify the MoreHorizontalIcon exists in hugeicons**

Run: `grep -r "MoreHorizontal" node_modules/@hugeicons/core-free-icons/dist/ --include="*.d.ts" -l`

If `MoreHorizontalIcon` is not found, check for alternatives:

Run: `grep -r "export.*More.*Icon" node_modules/@hugeicons/core-free-icons/dist/ --include="*.d.ts" | head -20`

Use whichever three-dot horizontal icon is available (e.g., `MoreHorizontalIcon`, `MoreHorizontalSquare01Icon`, or `Menu11Icon`). Update the import accordingly.

- [ ] **Step 5: Test manually in the browser**

Run: `bun dev`

Verify:
- Each folder card shows a `⋯` button to the left of the list/grid toggle
- Clicking `⋯` opens a dropdown with Rename, View in manager, and Delete
- "Rename" opens the editor dialog pre-filled with the folder name (no URL field)
- "Delete" opens the delete confirmation dialog mentioning the folder name and contents
- "View in manager" opens Chrome's bookmark manager (works in Chrome extension mode only)
- The dropdown closes after selecting an item

- [ ] **Step 6: Type check**

Run: `bun run typecheck`

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/features/bookmark-card/bookmark-card.tsx
git commit -m "feat: add overflow menu to folder cards for rename, view, and delete"
```

---

### Task 2: Add maxColumns and containerMode to preferences store

**Files:**
- Modify: `src/stores/preferences-store.ts`

- [ ] **Step 1: Add new fields to PreferencesState interface**

In the `PreferencesState` interface, add after the `colorTheme` field:

```typescript
maxColumns: number
containerMode: "fluid" | "contained"
```

And add after the `setColorTheme` action:

```typescript
setMaxColumns(value: number): void
setContainerMode(mode: "fluid" | "contained"): void
```

- [ ] **Step 2: Add default values to the store initial state**

In the `create<PreferencesState>` call, add after `colorTheme: "default"`:

```typescript
maxColumns: 4,
containerMode: "fluid" as const,
```

- [ ] **Step 3: Load saved preferences in init**

In the `init` method, expand the `Promise.all` to load the two new keys. Replace the existing destructure:

```typescript
const [cardLayouts, nestedFolders, adapterMode, colorTheme, maxColumns, containerMode] =
  await Promise.all([
    adapter.storage.get<Record<string, CardLayout>>("cardLayouts"),
    adapter.storage.get<boolean>("nestedFolders"),
    adapter.storage.get<"browser" | "standalone">("adapterMode"),
    adapter.storage.get<ColorTheme>("colorTheme"),
    adapter.storage.get<number>("maxColumns"),
    adapter.storage.get<"fluid" | "contained">("containerMode"),
  ])
```

And expand the `set()` call to include:

```typescript
maxColumns: maxColumns ?? 4,
containerMode: containerMode ?? "fluid",
```

- [ ] **Step 4: Add setter actions**

Add after the `setColorTheme` action:

```typescript
setMaxColumns(value: number) {
  set({ maxColumns: value })
  get().adapter?.storage.set("maxColumns", value)
},

setContainerMode(mode: "fluid" | "contained") {
  set({ containerMode: mode })
  get().adapter?.storage.set("containerMode", mode)
},
```

- [ ] **Step 5: Type check**

Run: `bun run typecheck`

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/stores/preferences-store.ts
git commit -m "feat: add maxColumns and containerMode preferences"
```

---

### Task 3: Update BookmarkGrid to use dynamic columns and container mode

**Files:**
- Modify: `src/features/bookmark-grid/bookmark-grid.tsx`

- [ ] **Step 1: Add a helper to build responsive column classes**

Add this function above the `BookmarkGrid` component, after the `collectAllFolders` function:

```typescript
const COLUMN_BREAKPOINTS = [
  "columns-1",
  "sm:columns-2",
  "md:columns-3",
  "lg:columns-4",
  "xl:columns-5",
  "2xl:columns-6",
]

function getColumnClasses(maxColumns: number): string {
  return COLUMN_BREAKPOINTS.slice(0, maxColumns).join(" ")
}
```

- [ ] **Step 2: Read preferences in the component**

Add these lines inside `BookmarkGrid`, after the existing `const nestedFolders = ...`:

```typescript
const maxColumns = usePreferencesStore((s) => s.maxColumns)
const containerMode = usePreferencesStore((s) => s.containerMode)
```

- [ ] **Step 3: Replace the static column classes with dynamic ones**

Replace the return block (the `<div className="columns-1 gap-4 ...">` wrapper) with:

```tsx
return (
  <div
    className={cn(
      containerMode === "contained" && "mx-auto max-w-[1440px]"
    )}
  >
    <div
      className={cn(getColumnClasses(maxColumns), "gap-4")}
      style={{ columnFill: "balance" }}
    >
      {folders.map((folder) => (
        <div key={folder.id} className="mb-4 break-inside-avoid">
          <BookmarkCard folder={folder} />
        </div>
      ))}
    </div>
  </div>
)
```

- [ ] **Step 4: Add the cn import if not present**

Add at the top of the file:

```typescript
import { cn } from "@/lib/utils"
```

- [ ] **Step 5: Test manually in the browser**

Run: `bun dev`

Verify:
- Default behavior (4 columns on large screens) is unchanged
- The grid still shows 1 column on mobile, 2 on sm, 3 on md, 4 on lg

- [ ] **Step 6: Type check**

Run: `bun run typecheck`

Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/features/bookmark-grid/bookmark-grid.tsx
git commit -m "feat: use dynamic column classes and container mode in bookmark grid"
```

---

### Task 4: Add Layout section to Settings dialog

**Files:**
- Modify: `src/features/settings/settings-dialog.tsx`

- [ ] **Step 1: Add imports for Select components**

Add these imports to the top of `settings-dialog.tsx`:

```typescript
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select"
```

- [ ] **Step 2: Read and bind the new preferences**

Inside the `SettingsDialog` component, add after the existing `const setAdapterMode = ...` line:

```typescript
const maxColumns = usePreferencesStore((s) => s.maxColumns)
const setMaxColumns = usePreferencesStore((s) => s.setMaxColumns)
const containerMode = usePreferencesStore((s) => s.containerMode)
const setContainerMode = usePreferencesStore((s) => s.setContainerMode)
```

- [ ] **Step 3: Add section heading helper markup**

The settings dialog content area is `<div className="flex flex-col gap-6">`. We will restructure it to add section dividers. Replace the entire `<div className="flex flex-col gap-6">` block (everything between `</DialogHeader>` and `</DialogContent>`) with the following:

```tsx
<div className="flex flex-col gap-6">
  {/* Bookmarks section */}
  <RootFolderPicker value={rootFolderId} onChange={setRootFolderId} />

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

  {/* Layout section */}
  <div className="flex flex-col gap-4">
    <div className="border-t pt-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Layout
      </span>
    </div>

    <div className="flex flex-col gap-2">
      <Label className="text-sm font-medium">Max Columns</Label>
      <Select
        value={String(maxColumns)}
        onValueChange={(val) => setMaxColumns(Number(val))}
      >
        <SelectTrigger>
          <span>{maxColumns} columns</span>
        </SelectTrigger>
        <SelectContent>
          {[2, 3, 4, 5, 6].map((n) => (
            <SelectItem key={n} value={String(n)}>
              {n} columns
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Maximum number of columns in the dashboard grid. Fewer columns are
        used on smaller screens.
      </p>
    </div>

    <div className="flex flex-col gap-2">
      <Label className="text-sm font-medium">Container</Label>
      <Select
        value={containerMode}
        onValueChange={(val) =>
          setContainerMode(val as "fluid" | "contained")
        }
      >
        <SelectTrigger>
          <span>{containerMode === "fluid" ? "Fluid" : "Contained"}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="fluid">Fluid</SelectItem>
          <SelectItem value="contained">Contained</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Contained limits the dashboard to 1440px wide and centers it on
        the screen.
      </p>
    </div>
  </div>

  {/* Data section */}
  <div className="flex flex-col gap-4">
    <div className="border-t pt-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Data
      </span>
    </div>

    {/* Adapter mode */}
    <div className="flex flex-col gap-2">
      <Label className="text-sm font-medium">Bookmark Source</Label>
      <div className="flex gap-2">
        {(["browser", "standalone"] as const).map((mode) => (
          <Button
            key={mode}
            variant={adapterMode === mode ? "default" : "outline"}
            size="sm"
            onClick={() => setAdapterMode(mode)}
            className="capitalize"
          >
            {mode === "browser" ? "Browser" : "Standalone"}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Use browser bookmarks or manage an independent collection.
        Requires a page reload to take effect.
      </p>
    </div>

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
</div>
```

- [ ] **Step 4: Test manually in the browser**

Run: `bun dev`

Verify:
- Settings dialog shows three sections: Bookmarks (root folder, nested toggle), Layout (max columns, container), Data (source, import/export)
- Section headings "Layout" and "Data" appear with border-top dividers
- Max Columns select shows options 2-6, defaults to 4
- Container select shows Fluid/Contained, defaults to Fluid
- Changing Max Columns immediately updates the grid column count
- Changing Container to "Contained" centers the grid with a max width
- Settings persist after closing and reopening the dialog

- [ ] **Step 5: Type check**

Run: `bun run typecheck`

Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add src/features/settings/settings-dialog.tsx
git commit -m "feat: add Layout section to settings dialog with max columns and container mode"
```

---

### Task 5: Final verification and lint

**Files:**
- All modified files

- [ ] **Step 1: Run type check**

Run: `bun run typecheck`

Expected: No errors

- [ ] **Step 2: Run linter**

Run: `bun lint`

Expected: No errors (or only pre-existing warnings)

- [ ] **Step 3: Run formatter**

Run: `bun run format`

- [ ] **Step 4: Full manual verification**

Run: `bun dev`

Test the complete feature set:
1. **Folder rename:** Click `⋯` on a card → Rename → change name → Save → card title updates
2. **Folder delete:** Click `⋯` on a card → Delete → confirm → card disappears
3. **View in manager:** Click `⋯` on a card → View in manager (verify no crash in standalone mode)
4. **Max columns:** Settings → Layout → change max columns to 2 → grid shows max 2 columns → close and reopen settings → still shows 2
5. **Container mode:** Settings → Layout → change to Contained → grid centers with max width → resize browser window to verify centering

- [ ] **Step 5: Commit any format/lint fixes**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```

(Skip this commit if there are no changes after formatting.)
