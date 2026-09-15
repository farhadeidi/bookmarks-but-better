import * as React from "react"
import type { BookmarkNode } from "@/browser"
import type { CardDisplay } from "@/stores/preferences-store"

/** What decides how tall a card is. */
type CardHeightDisplay = Pick<CardDisplay, "cardLayouts" | "collapsedFolders">

/** Vertical gap between stacked cards, matching the column's `gap-4`. */
const CARD_GAP = 16

/**
 * A measurement only counts once it moves a card by this much. Cards are
 * discrete — a bookmark row, a grid cell — so anything smaller is sub-pixel
 * churn from font metrics or scrollbars, and re-balancing on it would trade a
 * reflow for a distribution that looks identical.
 */
const HEIGHT_CHANGE_THRESHOLD = 8

/**
 * Guess a card's height before it has ever been rendered.
 *
 * The constants come from one theme at one font size, so they drift with card
 * padding, row height, font stack and icon size — and `cols` cannot know how
 * wide the column actually is. They are only ever the first paint's answer:
 * `useMeasuredCardHeights` replaces each card's guess with its real height.
 */
export function estimateCardHeight(
  folder: BookmarkNode,
  display: CardHeightDisplay
): number {
  const bookmarks = (folder.children ?? []).filter((c) => c.url !== undefined)
  const count = bookmarks.length
  const layout = display.cardLayouts[folder.id] ?? "list"

  // Header (~40px) + padding (~24px)
  const chrome = 64

  // A collapsed card is its header and nothing else.
  if (display.collapsedFolders[folder.id]) return chrome

  if (layout === "grid") {
    // Grid: ~48px cells, ~5 per row in a typical column width, ~52px per row
    const cols = 5
    const rows = Math.ceil(count / cols)
    return chrome + rows * 52
  }

  // List: ~32px per item
  return chrome + count * 32
}

/**
 * Distribute folders into the shortest column, using each card's measured
 * height where one exists and its estimate until then.
 */
export function distributeToColumns(
  folders: BookmarkNode[],
  columnCount: number,
  display: CardHeightDisplay,
  measuredHeights: ReadonlyMap<string, number>
): BookmarkNode[][] {
  const columns: BookmarkNode[][] = Array.from(
    { length: columnCount },
    () => []
  )
  const heights = new Array(columnCount).fill(0)

  for (const folder of folders) {
    const height =
      measuredHeights.get(folder.id) ?? estimateCardHeight(folder, display)

    // Find the shortest column
    let shortest = 0
    for (let i = 1; i < columnCount; i++) {
      if (heights[i] < heights[shortest]) shortest = i
    }

    columns[shortest].push(folder)
    heights[shortest] += height + CARD_GAP
  }

  return columns
}

interface HeightRecord {
  height: number
  /** The card's width when measured; a change means the grid was resized. */
  width: number
  /** The distribution inputs this height was measured under. */
  generation: object
}

function sizeOf(entry: ResizeObserverEntry): { height: number; width: number } {
  const box = entry.borderBoxSize?.[0]
  return {
    height: Math.round(box?.blockSize ?? entry.contentRect.height),
    width: Math.round(box?.inlineSize ?? entry.contentRect.width),
  }
}

const NO_HEIGHTS: ReadonlyMap<string, number> = new Map()

/**
 * Observe the rendered cards and report their real heights.
 *
 * Feeding measurements back into a layout that then re-measures is where this
 * would normally oscillate, so acceptance is deliberately one-way. A card's
 * height may move freely once per *generation* — the identity of the inputs
 * that decide the distribution — and after that only upwards, and only by more
 * than the threshold. Each card therefore causes a bounded number of
 * re-balances per generation, and a generation only turns over when the
 * folders, the column count or the card layouts change: never in response to
 * our own re-balance. Once no card crosses the threshold there is no state
 * write, so nothing re-renders and the observer falls silent.
 *
 * Collapsing or expanding a card holds the columns still instead: the card
 * animates in place rather than sending its neighbours to other columns. Until
 * the generation turns over or the grid is resized, cards that already have a
 * height keep it. A new generation observes every card afresh, and a resize
 * (cards changing width) measures every card anew, so the next distribution
 * sees the heights the toggles produced.
 */
export function useMeasuredCardHeights(
  folders: BookmarkNode[],
  columnCount: number,
  display: CardHeightDisplay
) {
  const { cardLayouts, collapsedFolders } = display
  const [heights, setHeights] =
    React.useState<ReadonlyMap<string, number>>(NO_HEIGHTS)

  const records = React.useRef(new Map<string, HeightRecord>())
  const observedIds = React.useRef(new Map<Element, string>())
  const observedElements = React.useRef(new Map<string, Element>())
  const observer = React.useRef<ResizeObserver | null>(null)

  const generation = React.useMemo(
    () => ({ folders, columnCount, cardLayouts }),
    [folders, columnCount, cardLayouts]
  )
  const currentGeneration = React.useRef(generation)
  /** The generation a collapse toggle is holding still, if any. */
  const heldGeneration = React.useRef<object | null>(null)
  const lastInputs = React.useRef({ generation, collapsedFolders })
  // A layout effect lands in the commit, before the browser can deliver a
  // resize notification for the layout it just produced; a passive effect
  // could arrive after it and mistake new content for a card that grew.
  React.useLayoutEffect(() => {
    const last = lastInputs.current
    lastInputs.current = { generation, collapsedFolders }
    currentGeneration.current = generation

    if (generation === last.generation) {
      // Only a toggle under unchanged inputs holds. Loading a source's
      // preferences replaces the card layouts too, so it is a new generation.
      if (collapsedFolders !== last.collapsedFolders) {
        heldGeneration.current = generation
      }
      return
    }

    if (heldGeneration.current === null) return
    heldGeneration.current = null
    // A card whose size stopped changing during the hold would never report
    // again; observing it anew delivers its current height.
    const current = observer.current
    if (!current) return
    for (const element of observedElements.current.values()) {
      current.unobserve(element)
      current.observe(element)
    }
  }, [generation, collapsedFolders])

  const getObserver = React.useCallback(() => {
    // jsdom and older Safari have no ResizeObserver; there the estimates stand.
    if (typeof ResizeObserver === "undefined") return null

    observer.current ??= new ResizeObserver((entries) => {
      let changed = false

      // Cards only change width when the grid does, and a hold ends there:
      // the heights kept through it describe cards of another width, so every
      // card may move freely again on its next measurement. A card that does
      // not report (one unmounted far from the viewport) keeps its last real
      // height rather than falling back to an estimate.
      if (
        heldGeneration.current !== null &&
        entries.some((entry) => {
          const folderId = observedIds.current.get(entry.target)
          const previous =
            folderId === undefined ? undefined : records.current.get(folderId)
          return (
            previous !== undefined &&
            Math.abs(sizeOf(entry).width - previous.width) >=
              HEIGHT_CHANGE_THRESHOLD
          )
        })
      ) {
        heldGeneration.current = null
        const released = {}
        for (const [folderId, record] of records.current) {
          records.current.set(folderId, { ...record, generation: released })
        }
      }

      for (const entry of entries) {
        const folderId = observedIds.current.get(entry.target)
        if (folderId === undefined) continue

        const { height, width } = sizeOf(entry)
        // A hidden or detached card measures zero, which is not its height.
        if (height <= 0) continue

        const previous = records.current.get(folderId)
        if (previous !== undefined) {
          // Held still by a collapse toggle; a card measured for the first
          // time (one scrolled into view, say) still counts.
          if (heldGeneration.current === currentGeneration.current) continue

          const seenThisGeneration =
            previous.generation === currentGeneration.current
          const accepted = seenThisGeneration
            ? height >= previous.height + HEIGHT_CHANGE_THRESHOLD
            : Math.abs(height - previous.height) >= HEIGHT_CHANGE_THRESHOLD

          if (!accepted) {
            // Still worth recording: the card has now been seen under this
            // generation, so from here on it may only grow.
            records.current.set(folderId, {
              height: previous.height,
              width,
              generation: currentGeneration.current,
            })
            continue
          }
        }

        records.current.set(folderId, {
          height,
          width,
          generation: currentGeneration.current,
        })
        changed = true
      }

      if (!changed) return
      setHeights(
        new Map(
          Array.from(records.current, ([id, record]) => [id, record.height])
        )
      )
    })

    return observer.current
  }, [])

  const observeCard = React.useCallback(
    (folderId: string, element: HTMLElement | null) => {
      const previous = observedElements.current.get(folderId)
      if (previous) {
        getObserver()?.unobserve(previous)
        observedIds.current.delete(previous)
        observedElements.current.delete(folderId)
      }
      if (!element) return

      observedIds.current.set(element, folderId)
      observedElements.current.set(folderId, element)
      getObserver()?.observe(element)
    },
    [getObserver]
  )

  // One stable callback per card, so an unrelated re-render does not detach
  // and re-observe every card in the grid.
  const measureRefs = React.useMemo(() => {
    const callbacks = new Map<string, (element: HTMLElement | null) => void>()
    for (const folder of folders) {
      callbacks.set(folder.id, (element) => observeCard(folder.id, element))
    }
    return callbacks
  }, [folders, observeCard])

  React.useEffect(
    () => () => {
      observer.current?.disconnect()
      observer.current = null
      observedIds.current.clear()
      observedElements.current.clear()
    },
    []
  )

  return { heights, measureRefs }
}
