import type { BookmarkAdapter } from "@/browser"
import type { ConflictResolution, ImportPlanNode } from "./import-plan"

export interface ImportResult {
  /** Folders created. Folders merged into an existing one are not counted. */
  folders: number
  /** Folders that landed inside an existing folder of the same name. */
  merged: number
  /** Bookmarks created, including "keep both" duplicates. */
  bookmarks: number
  /** Existing bookmarks retitled in place because the user chose "replace". */
  replaced: number
  /** Conflicting bookmarks the user chose not to import. */
  skipped: number
  /**
   * Nodes that could not be written, including every descendant of a folder
   * whose own creation failed — those descendants have nowhere to go, so they
   * are reported as lost rather than silently forgotten.
   */
  failed: number
  /** The first error message seen, for showing the user *why* it went wrong. */
  firstError: string | null
}

/** Total nodes in a subtree, counting the nodes themselves. */
function countNodes(nodes: ImportPlanNode[]): number {
  let total = 0
  for (const node of nodes) {
    total += 1 + (node.kind === "folder" ? countNodes(node.children) : 0)
  }
  return total
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Carries out a plan from `planImport` under the user's conflict choices.
 *
 * Every write is isolated: a single rejected node (a URL the back-end refuses,
 * a transient daemon conflict) costs that node and — for a folder — its
 * subtree, never the rest of the import. This function never rejects, so a
 * caller cannot end up with a half-written tree and no message.
 *
 * A conflict with no recorded choice defaults to `"skip"`, so an import that
 * is confirmed without answering leaves what is already there alone.
 */
export async function executeImportPlan(
  bookmarks: BookmarkAdapter,
  nodes: ImportPlanNode[],
  parentId: string,
  resolutions: Record<string, ConflictResolution> = {},
  concurrency = 8
): Promise<ImportResult> {
  const result: ImportResult = {
    folders: 0,
    merged: 0,
    bookmarks: 0,
    replaced: 0,
    skipped: 0,
    failed: 0,
    firstError: null,
  }

  const record = (error: unknown, lost: number) => {
    result.failed += lost
    result.firstError ??= messageOf(error)
  }

  async function writeBookmark(
    node: Extract<ImportPlanNode, { kind: "bookmark" }>,
    target: string
  ): Promise<void> {
    const choice = node.conflict
      ? (resolutions[node.conflict.key] ?? "skip")
      : "keep-both"

    try {
      if (node.conflict && choice === "skip") {
        result.skipped += 1
        return
      }

      if (node.conflict && choice === "replace") {
        // The URLs are identical by definition of the conflict, so the only
        // thing left to carry over is the incoming title.
        await bookmarks.update(node.conflict.existingId, { title: node.title })
        result.replaced += 1
        return
      }

      await bookmarks.create({
        parentId: target,
        title: node.title,
        url: node.url,
      })
      result.bookmarks += 1
    } catch (error) {
      record(error, 1)
    }
  }

  async function write(level: ImportPlanNode[], target: string): Promise<void> {
    const folders = level.filter((n) => n.kind === "folder")
    const leaves = level.filter((n) => n.kind === "bookmark")

    for (let i = 0; i < leaves.length; i += concurrency) {
      await Promise.all(
        leaves
          .slice(i, i + concurrency)
          .map((node) => writeBookmark(node, target))
      )
    }

    // Folders are resolved level by level so their children have a real parent
    // id to attach to; `null` marks the ones whose subtree has to be abandoned.
    const targets = await Promise.all(
      folders.map(async (node) => {
        if (node.existingId) {
          result.merged += 1
          return node.existingId
        }
        try {
          const created = await bookmarks.create({
            parentId: target,
            title: node.title,
          })
          result.folders += 1
          return created.id
        } catch (error) {
          record(error, 1 + countNodes(node.children))
          return null
        }
      })
    )

    await Promise.all(
      folders.map((node, i) => {
        const id = targets[i]
        return id === null ? undefined : write(node.children, id)
      })
    )
  }

  await write(nodes, parentId)

  return result
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}

/** A short, human-readable summary of an import, for showing in the UI. */
export function formatImportResult(result: ImportResult): string {
  let summary = `Imported ${plural(result.bookmarks, "bookmark")} and ${plural(
    result.folders,
    "folder"
  )}.`

  const extras: string[] = []
  if (result.merged > 0) {
    extras.push(`${plural(result.merged, "folder")} merged`)
  }
  if (result.replaced > 0) {
    extras.push(`${plural(result.replaced, "duplicate")} replaced`)
  }
  if (result.skipped > 0) {
    extras.push(`${plural(result.skipped, "duplicate")} skipped`)
  }
  if (extras.length > 0) {
    summary += ` ${extras.join(", ")}.`
  }

  if (result.failed > 0) {
    summary += ` ${plural(result.failed, "item")} could not be imported`
    summary += result.firstError ? ` (${result.firstError}).` : "."
  }

  return summary
}
