import type { BookmarkAdapter } from "@/browser"
import { loadOrganizerItem } from "./bookmark-organizer-data"
import {
  BOOKMARK_ORGANIZER_ROOT_ID,
  type OrganizerItemData,
} from "./bookmark-organizer-types"
import {
  buildSequentialMoves,
  getBranchIdsToRefresh,
} from "./bookmark-organizer-reorder"

/**
 * The slice of headless-tree's `ItemInstance` this handler actually uses.
 *
 * Deliberately narrower than the real type: it keeps the drop logic — the
 * riskiest part of the organizer — testable without a rendered tree, a real
 * drag, or a jsdom `DataTransfer`.
 */
export interface DropTreeItem {
  getId(): string
  getTree(): DropTree
}

export interface DropTree {
  getItemInstance(id: string): {
    invalidateChildrenIds(optimistic?: boolean): Promise<void>
  }
  getItems(): { getId(): string }[]
}

export interface ChildrenChangeDeps {
  /** The folder the organizer is rooted at, or null when there is none. */
  effectiveRootId: string | null
  bookmarks: Pick<BookmarkAdapter, "getSubTree">
  /** `capabilities.move` — reparenting to a different folder. */
  moveEnabled: boolean
  /** `capabilities.reorder` — same-parent ordering through `move(index)`. */
  reorderEnabled: boolean
  /** `capabilities.setChildOrder` — whole-folder atomic ordering. */
  setChildOrderEnabled: boolean
  moveBookmark(
    id: string,
    destination: { parentId?: string; index: number }
  ): Promise<boolean>
  setChildOrder(folderId: string, orderedChildIds: string[]): Promise<boolean>
  /**
   * The ids the current drag is carrying. Read lazily because
   * `createOnDropHandler` calls back after the drag state is recorded.
   */
  draggedIds(): Set<string>
}

/**
 * Whether a drop may land, given what kind of target it is.
 *
 * Replaces headless-tree's built-in `canDrop` (which is just
 * `target.item.isFolder()`), so it has to re-assert that rule or drops onto
 * bookmarks become legal. It adds two more:
 *
 * - The source has to be able to express an order at all. headless-tree has
 *   its own `canReorder` for this, but consults it only while resolving a
 *   *pointer* target — `getNextDragTarget`, which the keyboard uses, proposes
 *   between-row positions regardless. Stating the rule here is what covers
 *   both paths, rather than leaving the keyboard offering a gesture whose
 *   ordering half would be dropped on the floor.
 * - The daemon's own: a folder whose child order is frozen refuses a drop
 *   *between* its children, while a drop *onto* it — a plain reparent, which
 *   needs no order file — stays fine.
 */
export function canDropOnTarget(params: {
  isFolder: boolean
  orderReadOnly: boolean | undefined
  /** True for a drop between children, false for a drop onto the folder. */
  isOrderedTarget: boolean
  /** `capabilities.reorder || capabilities.setChildOrder`. */
  reorderAllowed: boolean
  setChildOrderEnabled: boolean
}): boolean {
  if (!params.isFolder) return false
  if (!params.isOrderedTarget) return true
  if (!params.reorderAllowed) return false
  if (!params.setChildOrderEnabled) return true
  return !params.orderReadOnly
}

function createMissingOrganizerItem(
  id: string,
  parentId: string | null
): OrganizerItemData {
  return {
    id,
    title: "Missing Bookmark",
    kind: "bookmark",
    parentId,
    index: 0,
    childCount: 0,
  }
}

/**
 * Builds the callback `createOnDropHandler` drives.
 *
 * Two shapes live here, chosen by capability and never mixed:
 *
 * - **Legacy** (Chrome, Firefox, Standalone): one `move(id, {parentId, index})`
 *   per child, in list order. Untouched by the ordering work.
 * - **Whole-folder** (daemon): reparent only what actually changed parents,
 *   then replace the destination folder's entire child order in one atomic
 *   request.
 */
export function createChildrenChangeHandler(deps: ChildrenChangeDeps) {
  return async function handleChildrenChange(
    item: DropTreeItem,
    newChildren: string[]
  ): Promise<void> {
    const parentTreeItem = item.getTree().getItemInstance(item.getId())
    const parentId =
      item.getId() === BOOKMARK_ORGANIZER_ROOT_ID
        ? deps.effectiveRootId
        : item.getId()

    if (!parentId) {
      return
    }

    if (deps.setChildOrderEnabled) {
      await applyChildOrder(deps, item, parentId, newChildren)
      return
    }

    const items = await Promise.all(
      newChildren.map(async (childId) => {
        return (
          (await loadOrganizerItem(deps.bookmarks, childId)) ??
          createMissingOrganizerItem(childId, parentId)
        )
      })
    )

    const moves = buildSequentialMoves(items, parentId)
    const originalParentById = new Map(
      items.map((original) => [original.id, original.parentId])
    )

    for (const move of moves) {
      const isReparent = originalParentById.get(move.id) !== move.parentId
      // Skip a pure same-parent position change when the adapter can't
      // persist it — sending it anyway would just churn a revision for a
      // write the daemon doesn't apply.
      if (!isReparent && !deps.reorderEnabled) continue
      if (isReparent && !deps.moveEnabled) continue

      await deps.moveBookmark(move.id, {
        parentId: move.parentId ?? undefined,
        index: move.index,
      })
    }

    await parentTreeItem.invalidateChildrenIds(true)
  }
}

/** At most one reparent per dragged item, then exactly one order write. */
async function applyChildOrder(
  deps: ChildrenChangeDeps,
  item: DropTreeItem,
  parentId: string,
  newChildren: string[]
): Promise<void> {
  const treeInstance = item.getTree()
  const parentTreeItem = treeInstance.getItemInstance(item.getId())
  const draggedIds = deps.draggedIds()

  // `createOnDropHandler` calls back twice per drop, and neither call says
  // which pass it is. The removal pass hands us the source folder *without*
  // the dragged ids — a list the folder does not match, which the daemon
  // refuses (422 invalid_order), and one it does not need: `move` rewrites the
  // source folder's own order inside the same transaction. Only the pass that
  // contains the dragged ids describes an order worth writing, and it is the
  // reason exactly one PUT leaves per drop instead of two.
  if (!newChildren.some((id) => draggedIds.has(id))) {
    return
  }

  // Only the dragged items can have changed parents, and only their old
  // parent is needed — the rest of the list travels in the order payload,
  // which the adapter validates against the server anyway. Loading all of
  // them would put one request per row behind every drop.
  const items = await Promise.all(
    newChildren
      .filter((childId) => draggedIds.has(childId))
      .map(async (childId) => {
        return (
          (await loadOrganizerItem(deps.bookmarks, childId)) ??
          createMissingOrganizerItem(childId, parentId)
        )
      })
  )

  const branchIds = new Set<string>()
  for (const child of items) {
    if (child.parentId === parentId) continue
    if (!deps.moveEnabled) {
      // headless-tree has already applied the new position optimistically, so
      // an exit that writes nothing still has to put the row back where the
      // server says it is — otherwise it renders in a folder it never reached.
      await parentTreeItem.invalidateChildrenIds(true)
      return
    }

    for (const branchId of getBranchIdsToRefresh({
      sourceParentId: child.parentId,
      destinationParentId: parentId,
      movedId: child.id,
    })) {
      branchIds.add(branchId)
    }

    // The order below is a permutation of what the destination holds *after*
    // the move, so the move has to land first — and if it didn't, writing an
    // order against a folder we guessed wrong about is worse than writing
    // nothing at all.
    const moved = await deps.moveBookmark(child.id, {
      parentId,
      index: newChildren.indexOf(child.id),
    })
    if (!moved) {
      await parentTreeItem.invalidateChildrenIds(true)
      return
    }
  }

  // Deliberately not conditioned on success: a refused order must snap the
  // optimistic row position back to server truth, and re-reading the folder's
  // children is what does that.
  await deps.setChildOrder(parentId, newChildren)

  const knownIds = new Set(treeInstance.getItems().map((i) => i.getId()))
  for (const branchId of branchIds) {
    const mapped =
      branchId === deps.effectiveRootId ? BOOKMARK_ORGANIZER_ROOT_ID : branchId
    if (mapped === item.getId() || !knownIds.has(mapped)) continue
    await treeInstance.getItemInstance(mapped).invalidateChildrenIds(true)
  }

  await parentTreeItem.invalidateChildrenIds(true)
}
