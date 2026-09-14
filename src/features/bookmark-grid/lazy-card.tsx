import * as React from "react"
import type { BookmarkNode } from "@/browser"
import { collectCardItems } from "./grid-navigation"
import { GridNavigationContext, NO_SUBSCRIPTION } from "./use-grid-navigation"
import { LazyCardsContext } from "./lazy-cards-gate"

/**
 * A folder card that exists in full only near the viewport.
 *
 * Every bookmark row carries a hover card, a drag source, a drop target and a
 * favicon lookup, so a collection of ten thousand bookmarks mounted all at
 * once is tens of thousands of listeners and a gigabyte of heap before the
 * first paint — which is how the new tab hung and crashed (issue #75). The
 * grid still lays out every card, but a card further than a viewport away is
 * a placeholder the height of its last measurement (its estimate until it has
 * ever been measured), and its rows are torn down again once it scrolls away.
 *
 * One thing pins a card open regardless of the viewport: the keyboard focus,
 * because the grid's roving tab stop has to land on an element that exists
 * (`useGridNavigation` focuses it once it registers). A drag needs no pin of
 * its own — the browser scrolls the page for it, and scrolling is what
 * mounts cards.
 *
 * In nested mode a card wraps each of its sub-folder cards the same way, so
 * a deep tree under one root is not one enormous card either.
 *
 * None of this applies below `LAZY_CARDS_ABOVE` bookmarks (see
 * `lazy-cards-gate.ts`): the grid decides once per tree and hands the answer
 * down through `LazyCardsContext`, and an ungated card is just its children.
 *
 * Without an IntersectionObserver (jsdom) every card is simply mounted.
 */

/** How far beyond the viewport a card is already worth mounting. */
const NEAR_VIEWPORT_MARGIN = "100% 0px"

type OnNear = (near: boolean, height: number) => void

const observed = new WeakMap<Element, OnNear>()

interface SharedObserver {
  observer: IntersectionObserver
  /** Elements watched right now; at zero the observer is let go. */
  count: number
}

/** One observer per scroll root, shared by every card scrolling inside it. */
const observers = new Map<Element | null, SharedObserver>()

/**
 * Each element's answer from `findScrollRoot`, so the cards of one column —
 * which share every ancestor — ask `getComputedStyle` once between them
 * instead of once per card per ancestor. With 300 cards that walk was the
 * grid's largest cost of its own on mount (issue #85). Weak, so a torn-down
 * grid takes its entries with it; the grid never re-parents its DOM, so an
 * element's scroll root does not change while it lives.
 */
const scrollRoots = new WeakMap<Element, Element | null>()

/**
 * The element whose scroll position decides what is near: the dashboard's own
 * scroll area, found generically rather than by name. With the viewport as the
 * root an ancestor scroll container would clip a card away before the margin
 * could count it as near.
 */
function findScrollRoot(element: Element): Element | null {
  const visited: Element[] = []
  let root: Element | null = null
  for (
    let node = element.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const cached = scrollRoots.get(node)
    if (cached !== undefined) {
      root = cached
      break
    }
    const { overflowY } = getComputedStyle(node)
    if (overflowY === "auto" || overflowY === "scroll") {
      root = node
      break
    }
    visited.push(node)
  }
  for (const node of visited) scrollRoots.set(node, root)
  return root
}

function observeNear(element: Element, onNear: OnNear): () => void {
  const root = findScrollRoot(element)
  let shared = observers.get(root)
  if (!shared) {
    shared = {
      observer: new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            observed.get(entry.target)?.(
              entry.isIntersecting,
              entry.boundingClientRect.height
            )
          }
        },
        { root, rootMargin: NEAR_VIEWPORT_MARGIN }
      ),
      count: 0,
    }
    observers.set(root, shared)
  }
  const { observer } = shared
  shared.count += 1
  observed.set(element, onNear)
  observer.observe(element)
  return () => {
    observed.delete(element)
    observer.unobserve(element)
    const current = observers.get(root)
    if (current?.observer !== observer) return
    current.count -= 1
    if (current.count === 0) {
      observer.disconnect()
      observers.delete(root)
    }
  }
}

interface LazyCardProps {
  folder: BookmarkNode
  nestedFolders: boolean
  /** The card's height before it has ever been rendered. */
  estimatedHeight: number
  /**
   * Where `useMeasuredCardHeights` looks; attached only while the card is
   * real. A nested card is not measured — its parent is.
   */
  measureRef?: (element: HTMLElement | null) => void
  children: React.ReactNode
}

export function LazyCard({
  folder,
  nestedFolders,
  estimatedHeight,
  measureRef,
  children,
}: LazyCardProps) {
  const gated = React.useContext(LazyCardsContext)
  if (!gated) {
    return (
      <div ref={measureRef} className="min-w-0">
        {children}
      </div>
    )
  }
  return (
    <GatedCard
      folder={folder}
      nestedFolders={nestedFolders}
      estimatedHeight={estimatedHeight}
      measureRef={measureRef}
    >
      {children}
    </GatedCard>
  )
}

function GatedCard({
  folder,
  nestedFolders,
  estimatedHeight,
  measureRef,
  children,
}: LazyCardProps) {
  const navigation = React.useContext(GridNavigationContext)

  const itemIds = React.useMemo(
    () => new Set(collectCardItems(folder, nestedFolders).map((i) => i.id)),
    [folder, nestedFolders]
  )
  const holdsActiveItem = React.useSyncExternalStore(
    navigation?.subscribe ?? NO_SUBSCRIPTION,
    () => {
      const active = navigation?.activeId() ?? null
      return active !== null && itemIds.has(active)
    }
  )

  // `lastHeight` is the height the placeholder keeps once the card has been
  // real: the layout must not shift when rows are torn down.
  const [viewport, setViewport] = React.useState<{
    near: boolean
    lastHeight: number | null
  }>(() => ({
    near: typeof IntersectionObserver === "undefined",
    lastHeight: null,
  }))
  const { near, lastHeight } = viewport

  const ref = React.useCallback((element: HTMLElement | null) => {
    if (!element || typeof IntersectionObserver === "undefined") return
    return observeNear(element, (isNear, height) => {
      setViewport((previous) => ({
        near: isNear,
        lastHeight: !isNear && height > 0 ? height : previous.lastHeight,
      }))
    })
  }, [])

  const mounted = near || holdsActiveItem

  return (
    <div ref={ref} className="min-w-0">
      {mounted ? (
        <div ref={measureRef} className="min-w-0">
          {children}
        </div>
      ) : (
        <div
          data-testid="bookmark-card-placeholder"
          className="flex w-full min-w-0 flex-col rounded-2xl bg-card p-4 ring-1 ring-border"
          style={{ minHeight: lastHeight ?? estimatedHeight }}
        >
          <h3 className="min-w-0 truncate text-base font-medium sm:text-sm">
            {folder.title}
          </h3>
        </div>
      )}
    </div>
  )
}
