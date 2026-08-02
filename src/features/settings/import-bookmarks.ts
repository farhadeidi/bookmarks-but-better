import type { BookmarkAdapter, BookmarkNode } from "@/browser"

export interface ImportResult {
  /** Folders successfully created. */
  folders: number
  /** Bookmarks successfully created. */
  bookmarks: number
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
function countNodes(nodes: BookmarkNode[]): number {
  let total = 0
  for (const node of nodes) {
    total += 1 + countNodes(node.children ?? [])
  }
  return total
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Writes a parsed bookmark tree under `parentId`.
 *
 * Every create is isolated: a single rejected node (a URL the back-end refuses,
 * a transient daemon conflict) costs that node and — for a folder — its
 * subtree, never the rest of the import. The previous implementation batched
 * creates through `Promise.all` with no error handling, so one rejection threw
 * out of the file-input handler and the user was left with a half-written tree
 * and no message at all.
 */
export async function importBookmarkNodes(
  bookmarks: BookmarkAdapter,
  nodes: BookmarkNode[],
  parentId: string,
  concurrency = 8
): Promise<ImportResult> {
  const result: ImportResult = {
    folders: 0,
    bookmarks: 0,
    failed: 0,
    firstError: null,
  }

  const record = (error: unknown, lost: number) => {
    result.failed += lost
    result.firstError ??= messageOf(error)
  }

  async function write(level: BookmarkNode[], target: string): Promise<void> {
    const folders: BookmarkNode[] = []
    const leaves: BookmarkNode[] = []
    for (const node of level) {
      if (node.url) leaves.push(node)
      else if (node.children) folders.push(node)
    }

    for (let i = 0; i < leaves.length; i += concurrency) {
      const batch = leaves.slice(i, i + concurrency)
      await Promise.all(
        batch.map(async (node) => {
          try {
            await bookmarks.create({
              parentId: target,
              title: node.title,
              url: node.url,
            })
            result.bookmarks += 1
          } catch (error) {
            record(error, 1)
          }
        })
      )
    }

    // Folders are created level by level so their children have a real parent
    // id to attach to; `null` marks the ones whose subtree has to be abandoned.
    const createdIds = await Promise.all(
      folders.map(async (node) => {
        try {
          const created = await bookmarks.create({
            parentId: target,
            title: node.title,
          })
          result.folders += 1
          return created.id
        } catch (error) {
          record(error, 1 + countNodes(node.children ?? []))
          return null
        }
      })
    )

    await Promise.all(
      folders.map((node, i) => {
        const id = createdIds[i]
        return id === null ? undefined : write(node.children ?? [], id)
      })
    )
  }

  await write(nodes, parentId)

  return result
}

/** A short, human-readable summary of an import, for showing in the UI. */
export function formatImportResult(result: ImportResult): string {
  const parts = [
    `${result.bookmarks} bookmark${result.bookmarks === 1 ? "" : "s"}`,
    `${result.folders} folder${result.folders === 1 ? "" : "s"}`,
  ]
  let summary = `Imported ${parts.join(" and ")}.`

  if (result.failed > 0) {
    summary += ` ${result.failed} item${result.failed === 1 ? "" : "s"} could not be imported`
    summary += result.firstError ? ` (${result.firstError}).` : "."
  }

  return summary
}
