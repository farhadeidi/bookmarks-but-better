import type { BookmarkNode } from "@/browser"

/**
 * Picks a parent folder id to create a new folder under when no root folder
 * is selected yet.
 *
 * `tree[0].id` (Chrome's invisible tree root, `"0"`) is rejected as a parent
 * by `chrome.bookmarks.create` — the same constraint documented in
 * `src/features/settings/import-target.ts` — so this returns the first real
 * child folder instead (Chrome's "Bookmarks bar", or the standalone/daemon
 * equivalent). Returns `null` when there is no such folder to create under.
 */
export function resolveDefaultCreateParentId(
  tree: BookmarkNode[]
): string | null {
  const root = tree[0]
  if (!root) return null

  const firstChildFolder = (root.children ?? []).find(
    (child) => child.url === undefined
  )
  return firstChildFolder?.id ?? null
}

/**
 * Resolves where to create a folder or bookmark when no root folder has been
 * explicitly selected — the id a "New Folder" / "New Bookmark" action should
 * target by default.
 *
 * When the active adapter's `tree[0]` is itself a real, creatable folder
 * (daemon, standalone — see `AdapterCapabilities.rootIsCreatable`), that's
 * the answer: there is nothing synthetic to walk past. Otherwise falls back
 * to `resolveDefaultCreateParentId`'s child-folder walk, which Chrome and
 * Firefox need.
 */
export function resolveEffectiveCreateParentId(
  tree: BookmarkNode[],
  rootIsCreatable: boolean
): string | null {
  if (rootIsCreatable) return tree[0]?.id ?? null
  return resolveDefaultCreateParentId(tree)
}
