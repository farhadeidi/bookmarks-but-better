import type { BookmarkNode } from "@/browser"
import { buildChildOrderForBookmarkReorder } from "@/features/dnd"

/**
 * The grid's keyboard model, as pure functions over what the grid renders.
 *
 * The dashboard is one composite widget: a single tab stop, moved around with
 * the arrow keys. A collection is 100–200 bookmarks, so one tab stop per
 * bookmark would mean crossing the page in 200 Tab presses.
 *
 * Arrow movement follows the *visual* order, which is not the DOM order of a
 * single list: `distributeToColumns` hands each card to the shortest column,
 * and each column is a flex column of cards. So Up/Down walks one column —
 * across the card boundaries inside it — and Left/Right steps between columns.
 */

/** One stop in the grid's roving tab order. */
export type GridNavigationItem =
  | { kind: "folder"; id: string }
  | { kind: "bookmark"; id: string; folderId: string }

export interface GridPosition {
  column: number
  row: number
}

/**
 * The items one card contributes, in the order `BookmarkCard` paints them:
 * its heading, then its direct bookmarks, then — in nested mode only — each
 * sub-folder card in full.
 */
function collectCardItems(
  folder: BookmarkNode,
  nestedFolders: boolean
): GridNavigationItem[] {
  const children = folder.children ?? []
  const items: GridNavigationItem[] = [{ kind: "folder", id: folder.id }]

  for (const child of children) {
    if (child.url !== undefined) {
      items.push({ kind: "bookmark", id: child.id, folderId: folder.id })
    }
  }

  if (nestedFolders) {
    for (const child of children) {
      if (child.url === undefined && child.children !== undefined) {
        items.push(...collectCardItems(child, nestedFolders))
      }
    }
  }

  return items
}

/** Flattens each rendered column into the sequence Up/Down walks. */
export function buildNavigationColumns(
  columns: BookmarkNode[][],
  nestedFolders: boolean
): GridNavigationItem[][] {
  return columns.map((column) =>
    column.flatMap((folder) => collectCardItems(folder, nestedFolders))
  )
}

export function findItemPosition(
  columns: GridNavigationItem[][],
  id: string
): GridPosition | null {
  for (let column = 0; column < columns.length; column++) {
    const row = columns[column].findIndex((item) => item.id === id)
    if (row !== -1) return { column, row }
  }

  return null
}

export function findItem(
  columns: GridNavigationItem[][],
  id: string
): GridNavigationItem | null {
  for (const column of columns) {
    const item = column.find((candidate) => candidate.id === id)
    if (item) return item
  }

  return null
}

/**
 * The item nearest a remembered position, which is how focus survives a
 * refresh that took the focused item away: a delete leaves whatever moved up
 * into its place, and a card that vanished entirely leaves the nearest
 * column. Both coordinates are clamped rather than required to exist, since a
 * mutation can shorten a column or empty one outright.
 */
export function itemAtPosition(
  columns: GridNavigationItem[][],
  position: GridPosition
): GridNavigationItem | null {
  // Fewer cards than columns leaves trailing columns empty, and clamping onto
  // one of those would find nothing to focus.
  const populated = columns
    .map((items, index) => ({ items, index }))
    .filter((column) => column.items.length > 0)
  if (populated.length === 0) return null

  let nearest = populated[0]
  for (const column of populated) {
    if (
      Math.abs(column.index - position.column) <
      Math.abs(nearest.index - position.column)
    ) {
      nearest = column
    }
  }

  const row = Math.min(Math.max(position.row, 0), nearest.items.length - 1)
  return nearest.items[row]
}

/**
 * Where a navigation key moves the tab stop, or `null` when it moves nowhere
 * and the keystroke is none of the grid's business.
 *
 * Movement deliberately does not wrap: the columns are a masonry layout, not
 * a ring, and arriving back at the top after passing the bottom of a column
 * reads as a jump rather than as travel.
 */
export function resolveNavigationTarget(params: {
  columns: GridNavigationItem[][]
  activeId: string
  key: string
}): string | null {
  const { columns, activeId, key } = params
  const from = findItemPosition(columns, activeId)
  if (!from) return null

  const column = columns[from.column]

  switch (key) {
    case "ArrowUp":
      return from.row > 0 ? column[from.row - 1].id : null
    case "ArrowDown":
      return from.row < column.length - 1 ? column[from.row + 1].id : null
    case "Home":
      return from.row > 0 ? column[0].id : null
    case "End":
      return from.row < column.length - 1 ? column[column.length - 1].id : null
    case "ArrowLeft":
    case "ArrowRight": {
      const step = key === "ArrowLeft" ? -1 : 1
      for (
        let index = from.column + step;
        index >= 0 && index < columns.length;
        index += step
      ) {
        const target = columns[index]
        if (target.length === 0) continue
        // A shorter neighbouring column keeps the row as close as it can,
        // which is the only answer that stays on screen.
        return target[Math.min(from.row, target.length - 1)].id
      }
      return null
    }
    default:
      return null
  }
}

export interface GridOrderingCapabilities {
  /** `capabilities.reorder`: a position persists through `move(id, {index})`. */
  reorder: boolean
  /**
   * `capabilities.setChildOrder` *and* the adapter actually exposing the
   * method — the same pair `DndMonitor` requires before routing anything
   * through whole-folder ordering.
   */
  setChildOrder: boolean
}

export type GridReorderPlan =
  | { kind: "move"; id: string; parentId: string; index: number }
  | { kind: "child-order"; folderId: string; orderedChildIds: string[] }

/**
 * What Alt+Up / Alt+Down should write, or `null` when the move must not be
 * offered at all.
 *
 * Alt+Arrow reorders a bookmark inside its own folder and nothing else. The
 * two write paths are the ones the drag already uses, chosen by capability
 * and never mixed: `reorder` means a position survives `move(id, {index})`
 * (Chrome, Firefox, Standalone), while `setChildOrder` means whole-folder
 * ordering is the only way to express it (daemon, whose `move()` has no
 * notion of an index). With neither, the keystroke does nothing — a gesture
 * whose ordering half the adapter would drop on the floor is worse than no
 * gesture.
 *
 * The read-only rules are restated here rather than assumed, exactly as
 * `canDropOnTarget` restates them for the organizer's keyboard drag: the
 * pointer path withholds a drag by not rendering a handle, and a keystroke
 * has no handle to withhold.
 */
export function planBookmarkReorder(params: {
  folder: BookmarkNode | null
  bookmarkId: string
  delta: 1 | -1
  capabilities: GridOrderingCapabilities
}): GridReorderPlan | null {
  const { folder, bookmarkId, delta, capabilities } = params
  if (!folder) return null
  if (!capabilities.reorder && !capabilities.setChildOrder) return null

  const children = folder.children ?? []
  const bookmarks = children.filter((child) => child.url !== undefined)
  const index = bookmarks.findIndex((child) => child.id === bookmarkId)
  if (index === -1) return null
  if (bookmarks[index].readOnly) return null

  const targetIndex = index + delta
  if (targetIndex < 0 || targetIndex >= bookmarks.length) return null

  if (capabilities.reorder) {
    // The bookmarks-only index the card renders, which is what the drag path
    // already sends to the same `move(id, {index})` call. Handing the two
    // paths different indices would make one of them wrong.
    return {
      kind: "move",
      id: bookmarkId,
      parentId: folder.id,
      index: targetIndex,
    }
  }

  // A folder whose order file is frozen accepts renames, moves and deletes
  // but refuses positional changes, so this one is withheld instead of being
  // sent and rejected.
  if (folder.orderReadOnly) return null

  // Reuses the drag path's permutation builder, which re-derives both
  // positions from the live children and refuses when either id is gone —
  // the same hardening a keyboard move needs, since the folder can change
  // between the render that placed the row and the keystroke that moves it.
  const orderedChildIds = buildChildOrderForBookmarkReorder({
    children,
    sourceId: bookmarkId,
    targetId: bookmarks[targetIndex].id,
    closestEdge: delta > 0 ? "bottom" : "top",
  })
  if (!orderedChildIds) return null

  return { kind: "child-order", folderId: folder.id, orderedChildIds }
}
