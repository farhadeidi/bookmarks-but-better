import * as React from "react"
import type { BookmarkNode } from "@/browser"

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
function estimateCardHeight(
  folder: BookmarkNode,
  cardLayouts: Record<string, string>
): number {
  const bookmarks = (folder.children ?? []).filter((c) => c.url !== undefined)
  const count = bookmarks.length
  const layout = cardLayouts[folder.id] ?? "list"

  // Header (~40px) + padding (~24px)
  const chrome = 64

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
  cardLayouts: Record<string, string>,
  measuredHeights: ReadonlyMap<string, number>
): BookmarkNode[][] {
  const columns: BookmarkNode[][] = Array.from(
    { length: columnCount },
    () => []
  )
  const heights = new Array(columnCount).fill(0)

  for (const folder of folders) {
    const height =
      measuredHeights.get(folder.id) ?? estimateCardHeight(folder, cardLayouts)

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
  /** The distribution inputs this height was measured under. */
  generation: object
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
 */
export function useMeasuredCardHeights(
  folders: BookmarkNode[],
  columnCount: number,
  cardLayouts: Record<string, string>
) {
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
  // A layout effect lands in the commit, before the browser can deliver a
  // resize notification for the layout it just produced; a passive effect
  // could arrive after it and mistake new content for a card that grew.
  React.useLayoutEffect(() => {
    currentGeneration.current = generation
  }, [generation])

  const getObserver = React.useCallback(() => {
    // jsdom and older Safari have no ResizeObserver; there the estimates stand.
    if (typeof ResizeObserver === "undefined") return null

    observer.current ??= new ResizeObserver((entries) => {
      let changed = false

      for (const entry of entries) {
        const folderId = observedIds.current.get(entry.target)
        if (folderId === undefined) continue

        const height = Math.round(
          entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height
        )
        // A hidden or detached card measures zero, which is not its height.
        if (height <= 0) continue

        const previous = records.current.get(folderId)
        if (previous !== undefined) {
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
              generation: currentGeneration.current,
            })
            continue
          }
        }

        records.current.set(folderId, {
          height,
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
