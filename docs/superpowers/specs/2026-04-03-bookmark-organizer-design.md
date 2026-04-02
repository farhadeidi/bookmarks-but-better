# Bookmark Organizer — Design Spec

**Date:** 2026-04-03  
**Scope:** Replace the current `Folder Order` feature with a root-scoped bookmark organizer side sheet. The organizer edits the real bookmark tree under the user's selected root. It does not redesign card-level sorting inside the dashboard or bookmark sorting inside folder cards.

---

## 1. Problem

The current `Folder Order` feature is a flat reorder list opened from Settings. It has several structural problems:

- It is hard to reach because it lives behind the Settings dialog.
- It only exposes a basic flat ordering UI instead of a real tree editor.
- It does not present editing actions in the same surface as sorting.
- It is conceptually separate from the real bookmark tree, which makes it feel like an app-only ordering layer.

The replacement should behave like a lightweight bookmark organizer for power users while staying scoped to the currently selected root folder.

---

## 2. Goals

- Replace `Folder Order` with a dedicated organizer surface.
- Scope the organizer to the subtree under the user's currently selected root.
- Use the real bookmark tree as the source of truth.
- Support live editing of folders and bookmarks: move, rename, create, and delete.
- Reuse existing edit/delete dialog patterns instead of duplicating forms inside the tree.
- Make the feature easier to reach from the main UI.

## 3. Non-Goals

- Redesign the existing bookmark sorting behavior inside folder cards.
- Redesign the experimental dashboard card-sorting feature behind the feature flag.
- Add inline rename or inline create flows in the tree for the first version.
- Add deep-link behavior that opens the organizer focused on a specific card.
- Build a full multi-panel bookmark-manager workspace.

---

## 4. Feature Name

Rename the feature from `Folder Order` to **Bookmark Organizer**.

This better matches the actual scope:

- The feature is not limited to folders.
- The feature edits a real subtree, not a display-priority list.
- The feature is a management surface, not a single-purpose ordering dialog.

---

## 5. Entry Points

Remove the current `Folder Order` row from Settings.

Expose the organizer in two places:

1. A bottom-bar icon button alongside the other global actions.
2. A new `Organize bookmarks` action in each folder card's `More` menu.

Current first-version behavior for both entry points:

- Opening from either place presents the same organizer sheet.
- The sheet opens to the full current-root view.
- It does not auto-focus or auto-reveal the clicked folder card.

That focused-entry behavior can be added later as a follow-up issue.

---

## 6. Surface And Layout

The organizer uses a right-side sheet instead of a dialog.

Implementation note:

- The project uses shadcn/ui with Base UI, not Radix UI.
- Use the shadcn `Sheet` component as the organizer container.
- Add it with `bunx --bun shadcn@latest add sheet` if the component is not already present.
- Use the official shadcn Base UI `Sheet` docs and Base UI dialog API as the implementation reference.

Layout structure:

1. **Sheet header**
   - Title: `Bookmark Organizer`
   - Short description explaining that changes apply to the selected root subtree

2. **Toolbar**
   - Global root selector
   - `New Folder` action
   - `New Bookmark` action

3. **Tree content**
   - A tree view starting at the selected root's direct children
   - The selected root itself is not rendered as a row
   - The tree fills the main vertical area and scrolls independently

4. **No Save/Cancel footer**
   - Edits apply live
   - Closing the sheet just closes the UI

---

## 7. Root Scoping

The organizer is strictly scoped to the currently selected root subtree.

Behavior:

- On open, the organizer reads the current global `rootFolderId`.
- The tree shows only the children under that root.
- The toolbar root selector can switch to a different root.
- Changing the root selector updates the global app root, matching behavior in other parts of the app.

This keeps the organizer consistent with the rest of the application and avoids introducing a second local root context.

---

## 8. Source Of Truth

The organizer edits the real bookmark tree, not an app-only display order.

Decisions:

- The old `folderOrder` concept is removed as the public behavior behind `Folder Order`.
- Folder and bookmark ordering for this feature comes from real bookmark sibling order under the selected root.
- Moving rows in the organizer calls the browser adapter's move operation with a real destination parent/index.

This aligns the app with browser-native ordering and removes the split between tree structure and app-specific display priority.

### Experimental Card Sorting Note

The existing experimental dashboard card-sorting work remains out of scope for this feature. This design does not expand or redesign that workflow. The organizer replaces the current `Folder Order` feature only.

---

## 9. Operations Supported In V1

The organizer supports full tree editing within the selected root subtree:

- Reorder folders
- Reorder bookmarks
- Move items across folders
- Rename folders and bookmarks
- Create folders
- Create bookmarks
- Delete folders
- Delete bookmarks

Editing rules:

- Actions apply live to the underlying bookmark tree.
- Rename and delete reuse the existing dialogs.
- Create flows use modal dialogs, not inline tree-row forms.

For the first version:

- No inline rename in tree rows
- No inline temporary create rows
- No staging model with save/discard

---

## 10. Tree Library Choice

Use **`headless-tree`** for the organizer.

Reasons:

- It fits a custom side-sheet UI better than a more opinionated batteries-included tree.
- It supports async data loading, which matches the desired lazy-loading strategy.
- It keeps row rendering and interaction styling in the app's control, which fits the existing shadcn/Base UI component approach.

Accepted tradeoff:

- `headless-tree` is a more composable, lower-level choice than `react-arborist`, so the app must provide more feature wiring itself.

---

## 11. Lazy Loading Strategy

The organizer uses lazy loading from day one.

Initial load:

- When the sheet opens, load the direct children of the selected root.

On expand:

- When a folder expands, load that folder's children on demand.
- Cache loaded children for the current organizer session.

Reload behavior:

- After create, move, rename, or delete, reload only the affected visible branch or branches.
- Do not rebuild the entire tree when a local branch refresh is sufficient.

Adapter shape:

- Use the existing bookmark adapter as the underlying source.
- The organizer feature adds a thin tree-oriented adapter layer to translate bookmark data into the shape expected by `headless-tree`.
- Existing adapter methods such as subtree loading and move operations remain the primitive operations.

---

## 12. Components

Create a dedicated organizer feature instead of stretching the current `folder-order-dialog` implementation.

### `bookmark-organizer-sheet`

Responsibilities:

- Own open/close state
- Render the shadcn `Sheet`
- Read and update the global root selection
- Host toolbar actions
- Mount the tree surface

### `bookmark-organizer-tree`

Responsibilities:

- Initialize and configure `headless-tree`
- Load visible branches lazily
- Handle expand/collapse state
- Handle row selection and drag/drop events

### `bookmark-organizer-row`

Responsibilities:

- Render one row for either a folder or a bookmark
- Show indentation, expand/collapse chevron, icon, title, and row actions
- Trigger rename/delete/open/create affordances through existing app flows

### `bookmark-organizer-adapter`

Responsibilities:

- Convert bookmark nodes into tree items
- Resolve child loading by parent id
- Compute move destinations for drag/drop
- Refresh specific branches after mutations

---

## 13. Dialog Reuse

The organizer should not duplicate the current editor forms.

Reuse strategy:

- `Rename` uses the existing bookmark editor dialog.
- `Delete` uses the existing delete confirmation dialog.
- `New Folder` and `New Bookmark` open dedicated modal dialogs built in the same dialog pattern as the current editor flows.
- If shared form markup is needed, extract reusable form content from the existing editor rather than duplicating tree-local forms.

Why:

- The current dialogs already handle folder/bookmark distinctions correctly.
- The organizer should remain a navigation and structure editor, not a second place that embeds standalone forms.
- Reusing them keeps this feature focused on navigation and tree editing rather than form duplication.

---

## 14. Interaction Model

Tree interactions:

- Single click selects a row.
- Folder chevrons expand or collapse rows.
- Drag and drop moves folders and bookmarks within the selected root subtree.
- Row actions open existing dialogs for rename/delete.
- Toolbar actions create new items in the current context.

Sheet interactions:

- Opening the sheet never blocks the rest of the app conceptually, but it behaves like a normal modal sheet from the right edge.
- Closing the sheet does not revert changes because edits are live.

---

## 15. Error Handling

Branch loading failures:

- Show an inline failed state on the affected branch.
- Provide a retry action for that branch.

Mutation failures:

- Keep the current UI stable.
- Show an error message or toast.
- Reload the affected branch after failure to restore truth from the adapter.

External changes while open:

- If bookmarks change externally, reload only the affected visible branch when possible.
- If a selected node disappears, clear stale selection and reload its visible parent branch.
- If the selected global root changes externally, the organizer switches to that root and reloads from there.

---

## 16. Testing Strategy

### Unit Tests

- Tree item mapping from bookmark nodes
- Selected-root scoping
- Lazy child loading
- Destination index and parent calculation for drag/drop
- Branch refresh behavior after mutations

### Integration Tests

- Opening the organizer from the bottom bar
- Opening the organizer from a folder card menu
- Changing the root selector updates global root selection
- Moving a folder within the tree
- Moving a bookmark across folders
- Renaming via the existing editor dialog
- Deleting via the existing confirmation dialog
- Creating a new folder or bookmark from the organizer toolbar

### Regression Tests

- The old `Folder Order` entry is removed from Settings
- Existing bookmark sorting inside folder cards is unchanged
- Existing experimental dashboard card sorting is not expanded by this feature

---

## 17. Files And State Expected To Change

Expected feature additions:

- New organizer feature directory and sheet UI
- New organizer open/close UI state
- New entry points in the bottom bar and folder card menu

Expected removals or replacements:

- `Folder Order` settings entry
- `FolderOrderDialog` as the primary user-facing organizer surface
- Public `Folder Order` naming in the UI

Expected preserved assets:

- Existing bookmark editor dialog
- Existing delete confirmation dialog
- Existing root selection behavior

---

## 18. Out Of Scope

- Reworking the current experimental card sorting inside the dashboard grid
- Redesigning bookmark drag/drop inside folder cards
- Adding focused-open behavior from a specific folder card
- Adding inline rename/create controls in the tree
- Adding search, bulk actions, multi-select, or preview panes
- Managing bookmarks outside the selected root subtree

---

## 19. Summary

`Folder Order` becomes `Bookmark Organizer`: a right-side sheet that edits the real bookmark tree under the selected root. It is opened from the bottom bar and folder card menus, uses `headless-tree` with lazy loading, applies changes live, and reuses the app's existing dialogs for edit and delete actions. This replaces the current flat reorder dialog with a more native, accessible, and scalable organizer without expanding the scope into a full standalone bookmark manager.
