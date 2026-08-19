import * as React from "react"
import type { BookmarkNode } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { findNodeById } from "@/lib/bookmark-utils"
import {
  buildNavigationColumns,
  findItem,
  findItemPosition,
  itemAtPosition,
  planBookmarkReorder,
  resolveNavigationTarget,
  type GridPosition,
} from "./grid-navigation"

/**
 * The grid's roving tab order, and the focus it has to keep hold of across a
 * refresh.
 *
 * `bookmark-store.refresh` replaces `tree` wholesale on every create, rename,
 * delete and move, so the item under the focus can simply stop existing.
 * Two things have to survive that: the single tab stop, which must still be
 * on something Tab can reach, and — when the grid was the thing holding the
 * focus — the focus itself.
 */

/** The props one grid item needs to take part in the roving tab order. */
export interface GridItemProps {
  ref: (element: HTMLElement | null) => void
  tabIndex: number
  onFocus: () => void
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void
}

export interface GridNavigation {
  subscribe(listener: () => void): () => void
  isActive(id: string): boolean
  activate(id: string): void
  registerItem(id: string, element: HTMLElement | null): void
  handleKeyDown(id: string, event: React.KeyboardEvent<HTMLElement>): void
}

export const GridNavigationContext = React.createContext<GridNavigation | null>(
  null
)

const NO_SUBSCRIPTION = () => () => {}

/**
 * Outside a grid there is no roving order to join, so the item reports itself
 * plainly tabbable — a card rendered on its own still behaves.
 */
export function useGridItem(id: string): GridItemProps {
  const navigation = React.useContext(GridNavigationContext)

  // Each item subscribes to its *own* active flag rather than reading a
  // context value that changes: an arrow key moves the tab stop between two
  // items, and re-rendering all 200 bookmarks to move a `tabIndex` twice is
  // what would make the keys feel slow.
  const isActive = React.useSyncExternalStore(
    navigation?.subscribe ?? NO_SUBSCRIPTION,
    () => navigation?.isActive(id) ?? true
  )

  const ref = React.useCallback(
    (element: HTMLElement | null) => navigation?.registerItem(id, element),
    [navigation, id]
  )
  const onFocus = React.useCallback(
    () => navigation?.activate(id),
    [navigation, id]
  )
  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLElement>) =>
      navigation?.handleKeyDown(id, event),
    [navigation, id]
  )

  return { ref, tabIndex: isActive ? 0 : -1, onFocus, onKeyDown }
}

interface GridNavigationOptions {
  /** The cards as `distributeToColumns` laid them out, i.e. in visual order. */
  columns: BookmarkNode[][]
  nestedFolders: boolean
}

export function useGridNavigation(options: GridNavigationOptions) {
  const { columns, nestedFolders } = options

  const navigationColumns = React.useMemo(
    () => buildNavigationColumns(columns, nestedFolders),
    [columns, nestedFolders]
  )

  const tree = useBookmarkStore((s) => s.tree)
  const moveBookmark = useBookmarkStore((s) => s.moveBookmark)
  const setChildOrder = useBookmarkStore((s) => s.setChildOrder)
  const reorderEnabled = useBookmarkStore(
    (s) => s.adapter?.capabilities.reorder ?? true
  )
  // Mirrors `DndMonitor`: the capability flag and the optional method must
  // agree before anything routes ordering through `setChildOrder`.
  const setChildOrderEnabled = useBookmarkStore(
    (s) =>
      (s.adapter?.capabilities.setChildOrder ?? false) &&
      s.adapter?.bookmarks.setChildOrder !== undefined
  )

  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const elements = React.useRef(new Map<string, HTMLElement>())
  const listeners = React.useRef(new Set<() => void>())
  const activeId = React.useRef<string | null>(null)
  const position = React.useRef<GridPosition | null>(null)
  const heldFocus = React.useRef(false)

  // Read by the key handler, which is stable and therefore closes over
  // nothing. Written in a layout effect rather than during render so the
  // render itself stays pure.
  const latest = React.useRef({
    navigationColumns,
    tree,
    moveBookmark,
    setChildOrder,
    reorderEnabled,
    setChildOrderEnabled,
  })
  React.useLayoutEffect(() => {
    latest.current = {
      navigationColumns,
      tree,
      moveBookmark,
      setChildOrder,
      reorderEnabled,
      setChildOrderEnabled,
    }
  })

  const setActiveId = React.useCallback((id: string | null) => {
    if (activeId.current !== id) {
      activeId.current = id
      for (const listener of listeners.current) listener()
    }
    // Remembered even when the id did not change, because the item may have
    // moved: this position is the only thing left to aim at once the id is
    // gone.
    position.current = id
      ? findItemPosition(latest.current.navigationColumns, id)
      : null
  }, [])

  const navigation = React.useMemo<GridNavigation>(
    () => ({
      subscribe(listener) {
        listeners.current.add(listener)
        return () => listeners.current.delete(listener)
      },
      isActive(id) {
        return activeId.current === id
      },
      activate(id) {
        setActiveId(id)
      },
      registerItem(id, element) {
        if (element) {
          elements.current.set(id, element)
        } else {
          elements.current.delete(id)
        }
      },
      handleKeyDown(id, event) {
        if (event.defaultPrevented) return
        // Ctrl/Command are the browser's and Shift is selection's; neither
        // belongs to the grid.
        if (event.ctrlKey || event.metaKey || event.shiftKey) return

        const state = latest.current

        if (event.altKey) {
          // Alt is what is left, and it costs nothing: the palette's
          // type-ahead already drops any keystroke carrying it, and an arrow
          // key is not a printable character either way.
          const delta =
            event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
          if (delta === 0) return

          const item = findItem(state.navigationColumns, id)
          // Folder cards are left out: their order is a client-local
          // preference over a masonry layout, where "the card above" is not
          // the previous card in the list being reordered.
          if (item?.kind !== "bookmark") return

          const plan = planBookmarkReorder({
            folder: findNodeById(state.tree, item.folderId),
            bookmarkId: id,
            delta,
            capabilities: {
              reorder: state.reorderEnabled,
              setChildOrder: state.setChildOrderEnabled,
            },
          })
          if (!plan) return

          event.preventDefault()
          if (plan.kind === "move") {
            void state.moveBookmark(plan.id, {
              parentId: plan.parentId,
              index: plan.index,
            })
          } else {
            void state.setChildOrder(plan.folderId, plan.orderedChildIds)
          }
          return
        }

        // Enter is deliberately absent: a bookmark row is an `<a href>`, so
        // opening it is the browser's own default, and claiming the key here
        // would only reimplement it.
        const targetId = resolveNavigationTarget({
          columns: state.navigationColumns,
          activeId: id,
          key: event.key,
        })
        if (!targetId) return

        event.preventDefault()
        setActiveId(targetId)
        elements.current.get(targetId)?.focus()
      },
    }),
    [setActiveId]
  )

  const containerProps = React.useMemo(
    () => ({
      ref: containerRef,
      onFocus: () => {
        heldFocus.current = true
      },
      onBlur: (event: React.FocusEvent<HTMLElement>) => {
        const next = event.relatedTarget
        if (next instanceof Node && containerRef.current?.contains(next)) return
        // A row unmounting under the focus reports the loss with nothing to
        // hand focus to and an element already out of the document. That is a
        // refresh, not the user leaving, and the flag has to survive it —
        // it is the whole permission to put focus back. (Chrome fires no
        // event at all in that case, which lands in the same place.)
        if (next === null && !event.target.isConnected) return
        heldFocus.current = false
      },
    }),
    []
  )

  // Runs after every refresh, since `refresh` replaces `tree` and the columns
  // are derived from it.
  React.useLayoutEffect(() => {
    const current = activeId.current
    const found = current ? findItemPosition(navigationColumns, current) : null
    if (found) {
      position.current = found
      return
    }

    const replacement = itemAtPosition(
      navigationColumns,
      position.current ?? { column: 0, row: 0 }
    )
    setActiveId(replacement?.id ?? null)
    if (!replacement) return

    // Moving focus the user never gave the grid would be worse than the reset
    // this is fixing, so it happens only when the grid was holding it and the
    // refresh dropped it on the floor.
    if (!heldFocus.current) return
    const active = document.activeElement
    if (
      active &&
      active !== document.body &&
      containerRef.current?.contains(active)
    ) {
      return
    }

    elements.current.get(replacement.id)?.focus()
  }, [navigationColumns, setActiveId])

  return { navigation, containerProps }
}
