/**
 * The Standalone Source sunset.
 *
 * Standalone is being retired: new users cannot select it, existing profiles
 * that were actively using it keep access through one major version, and the
 * removal release deletes exactly one factory (`createStandaloneAdapter`) plus
 * this module's warning UI. Everything the sunset needs is gathered here so
 * that removal is bounded.
 *
 * The migration path is explicit and non-destructive: copy the Standalone
 * bookmarks into a Browser or Daemon Source through the ordinary
 * import pipeline — preview, conflict handling, copy, verify — and leave the
 * Standalone data untouched throughout. Nothing here ever deletes it.
 */

import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import { createStandaloneAdapter } from "@/sources/adapters"
import {
  planImport,
  type ImportPlan,
  type ConflictResolution,
} from "@/features/settings/import-plan"
import {
  executeImportPlan,
  type ImportResult,
} from "@/features/settings/import-bookmarks"
import {
  STANDALONE_REMOVAL_MAJOR_VERSION,
  STANDALONE_SOURCE_ID,
} from "@/sources/config"

export { STANDALONE_REMOVAL_MAJOR_VERSION, STANDALONE_SOURCE_ID }

/** The one-line story every sunset surface tells. */
export const STANDALONE_DEPRECATION_MESSAGE =
  `Standalone bookmarks are being retired and will be removed in version ${STANDALONE_REMOVAL_MAJOR_VERSION}.0. ` +
  "Migrate to your Browser bookmarks or a Daemon Source — your Standalone data is kept until then."

/** Reads the Standalone collection without disturbing the active source. */
export async function readStandaloneTree(): Promise<BookmarkNode[]> {
  // Reading is side-effect free: the adapter's IndexedDB store is the same
  // one the Standalone source has always used, and nothing here writes.
  const adapter = createStandaloneAdapter()
  return adapter.bookmarks.getTree()
}

export function countBookmarks(nodes: BookmarkNode[]): number {
  let total = 0
  for (const node of nodes) {
    if (node.url) total += 1
    if (node.children) total += countBookmarks(node.children)
  }
  return total
}

export interface MigrationPreview {
  plan: ImportPlan
  /** Total bookmarks awaiting copy. */
  bookmarks: number
  /** Total folders awaiting copy (folders merged into existing ones not counted). */
  folders: number
  /** Conflicts needing a resolution before or during the copy. */
  conflicts: number
  /** Bookmarks the destination holds before anything is copied. */
  destinationBookmarks: number
}

/**
 * Plans the copy: what the Standalone collection holds, laid against what the
 * destination already has. Nothing is written.
 */
export function planStandaloneMigration(
  standaloneTree: BookmarkNode[],
  destinationTree: BookmarkNode[],
  destinationParentId: string
): MigrationPreview {
  const nodes = standaloneTree.flatMap((root) => root.children ?? [])
  const plan = planImport(destinationTree, destinationParentId, nodes)

  let bookmarks = 0
  let folders = 0
  const walk = (level: ImportPlan["nodes"]) => {
    for (const node of level) {
      if (node.kind === "bookmark") {
        bookmarks += 1
      } else {
        if (!node.existingId) folders += 1
        walk(node.children)
      }
    }
  }
  walk(plan.nodes)

  return {
    plan,
    bookmarks,
    folders,
    conflicts: plan.conflicts.length,
    destinationBookmarks: countBookmarks(destinationTree),
  }
}

export interface MigrationOutcome {
  result: ImportResult
  /** Bookmarks visible in the destination after the copy, re-read from it. */
  verifiedCount: number
  /**
   * Whether the destination actually holds the bookmarks the copy reports
   * having created. Verification is a re-read, never a trust exercise.
   */
  verified: boolean
}

/**
 * Performs the copy and then verifies it by re-reading the destination.
 *
 * A conflict with no recorded choice defaults to `"skip"` — the same rule the
 * import pipeline applies — so confirming without answering leaves what is
 * already in the destination alone.
 */
export async function runStandaloneMigration(
  destination: BookmarkAdapter,
  preview: MigrationPreview,
  destinationParentId: string,
  resolutions: Record<string, ConflictResolution> = {}
): Promise<MigrationOutcome> {
  const result = await executeImportPlan(
    destination,
    preview.plan.nodes,
    destinationParentId,
    resolutions
  )

  const tree = await destination.getTree()
  const verifiedCount = countBookmarks(tree)
  const verified =
    result.failed === 0 &&
    verifiedCount >= preview.destinationBookmarks + result.bookmarks

  return { result, verifiedCount, verified }
}
