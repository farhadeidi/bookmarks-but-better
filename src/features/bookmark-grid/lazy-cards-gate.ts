import * as React from "react"
import type { BookmarkNode } from "@/browser"

/**
 * Whether a grid gates its cards on the viewport (see `LazyCard`).
 *
 * Most collections are a few hundred bookmarks, fit in memory many times
 * over, and lose nothing by mounting whole — while gating would cost them the
 * browser's find-in-page over the cards below the fold. So the grid decides
 * once per tree, and below `LAZY_CARDS_ABOVE` it is the plain,
 * everything-mounted grid it always was.
 */
export const LAZY_CARDS_ABOVE = 500

/** Whether the cards under this root are worth gating; see `LAZY_CARDS_ABOVE`. */
export function shouldGateCards(root: BookmarkNode): boolean {
  return countBookmarks(root) > LAZY_CARDS_ABOVE
}

function countBookmarks(node: BookmarkNode): number {
  let count = 0
  for (const child of node.children ?? []) {
    if (child.url !== undefined) count += 1
    else count += countBookmarks(child)
  }
  return count
}

/** True inside a grid that gates its cards. Outside a grid, nothing is gated. */
export const LazyCardsContext = React.createContext(false)
