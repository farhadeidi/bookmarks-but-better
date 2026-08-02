import type { BookmarkNode } from "@/browser"

export type ConflictResolution = "skip" | "replace" | "keep-both"

/** A single incoming bookmark that already exists in its destination folder. */
export interface ImportConflict {
  /** Stable identity for the resolution map; opaque to the UI. */
  key: string
  /** " > "-joined folder path below the destination, for showing the user where. */
  path: string
  incomingTitle: string
  existingTitle: string
  url: string
}

export type ImportPlanNode =
  | {
      kind: "folder"
      title: string
      /** Set when an existing folder of the same name is being merged into. */
      existingId: string | null
      children: ImportPlanNode[]
    }
  | {
      kind: "bookmark"
      title: string
      url: string
      /** Set when this bookmark collides with one already in the destination. */
      conflict: { key: string; existingId: string } | null
    }

export interface ImportPlan {
  nodes: ImportPlanNode[]
  conflicts: ImportConflict[]
}

/**
 * Canonical form used to decide whether two bookmarks point at the same place.
 *
 * Scheme and host are case-insensitive per RFC 3986 and a default port means
 * the same thing as no port, so those are folded. Path, query and fragment are
 * left alone — `#/inbox` and `#/sent` are genuinely different bookmarks in a
 * single-page app, and silently merging them would lose one.
 */
export function normalizeUrl(url: string): string {
  const trimmed = url.trim()

  try {
    const parsed = new URL(trimmed)
    // Opaque schemes (`javascript:`, `mailto:`, `place:`) have no authority to
    // reassemble around; `href` already folds their scheme case for us.
    if (!parsed.host) return parsed.href
    const path = parsed.pathname === "/" ? "" : parsed.pathname
    return `${parsed.protocol}//${parsed.host}${path}${parsed.search}${parsed.hash}`
  } catch {
    // `javascript:`, `place:` and friends have no comparable structure.
    return trimmed.toLowerCase()
  }
}

function sameFolderName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function findNodeById(nodes: BookmarkNode[], id: string): BookmarkNode | null {
  for (const node of nodes) {
    if (node.id === id) return node
    const found = findNodeById(node.children ?? [], id)
    if (found) return found
  }
  return null
}

/**
 * Works out what importing `imported` under `destinationId` would actually do,
 * without writing anything.
 *
 * Folders merge by name, the way a file manager merges directories: an
 * incoming "Dev Tools" lands inside the existing "Dev Tools" instead of
 * creating a second one, and its contents are then compared one level deeper.
 * Bookmarks collide on URL within the folder they end up in, and each
 * collision becomes a conflict for the user to resolve.
 *
 * Duplicates *within the imported file itself* are not conflicts — the file is
 * what the user exported, and there is no existing node to skip or replace.
 */
export function planImport(
  tree: BookmarkNode[],
  destinationId: string,
  imported: BookmarkNode[]
): ImportPlan {
  const destination = findNodeById(tree, destinationId)
  const conflicts: ImportConflict[] = []
  let keyCounter = 0

  function planLevel(
    nodes: BookmarkNode[],
    existing: BookmarkNode[],
    path: string[]
  ): ImportPlanNode[] {
    const existingByUrl = new Map<string, BookmarkNode>()
    for (const node of existing) {
      if (node.url === undefined) continue
      const key = normalizeUrl(node.url)
      // First one wins, so a destination that already holds duplicates
      // resolves against a single, predictable node.
      if (!existingByUrl.has(key)) existingByUrl.set(key, node)
    }

    return nodes.map((node): ImportPlanNode => {
      if (node.url !== undefined) {
        const match = existingByUrl.get(normalizeUrl(node.url))
        if (!match) {
          return {
            kind: "bookmark",
            title: node.title,
            url: node.url,
            conflict: null,
          }
        }

        // One existing bookmark can only be skipped or replaced once. Claiming
        // it here means a second incoming copy of the same URL is planned as
        // new rather than pointed at the same node — otherwise "replace all"
        // would fire two concurrent updates at one bookmark and leave whichever
        // won as its title (or, on a revision-checking adapter, fail one).
        existingByUrl.delete(normalizeUrl(node.url))

        const key = `c${keyCounter++}`
        conflicts.push({
          key,
          path: path.join(" > "),
          incomingTitle: node.title,
          existingTitle: match.title,
          url: node.url,
        })
        return {
          kind: "bookmark",
          title: node.title,
          url: node.url,
          conflict: { key, existingId: match.id },
        }
      }

      const match = existing.find(
        (child) =>
          child.url === undefined && sameFolderName(child.title, node.title)
      )

      return {
        kind: "folder",
        title: node.title,
        existingId: match?.id ?? null,
        children: planLevel(node.children ?? [], match?.children ?? [], [
          ...path,
          node.title,
        ]),
      }
    })
  }

  return {
    nodes: planLevel(imported, destination?.children ?? [], []),
    conflicts,
  }
}

/** Number of bookmarks a plan would leave untouched under the given choices. */
export function countResolved(
  conflicts: ImportConflict[],
  resolutions: Record<string, ConflictResolution>,
  resolution: ConflictResolution
): number {
  return conflicts.filter((c) => resolutions[c.key] === resolution).length
}
