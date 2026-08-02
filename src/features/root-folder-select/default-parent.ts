import type { BookmarkNode } from "@/browser"

/**
 * Ids of the browser's permanent "bookmarks bar" folder, most preferred first.
 *
 * Both engines guarantee this folder exists in every profile and refuse to let
 * it be renamed, moved or removed — Chrome documents "You also cannot rename,
 * move, or remove the special 'Bookmarks Bar' and 'Other Bookmarks' folders",
 * and Firefox raises "The bookmark root cannot be modified" for the same — so
 * matching on the id is safe in a way that matching on a (localized) title
 * would not be.
 *
 * `"1"` is Chrome's Bookmarks Bar; `"toolbar_____"` is the Firefox Places GUID
 * for the Bookmarks Toolbar. Firefox needs naming explicitly because its root
 * children start with the Bookmarks *Menu* (`menu________`), so "the first
 * child folder" would silently mean a different folder there than in Chrome.
 */
const BOOKMARKS_BAR_IDS = ["1", "toolbar_____"]

/**
 * Picks a parent folder id to create a new folder under when no root folder
 * is selected yet.
 *
 * `tree[0].id` (Chrome's invisible tree root, `"0"`, and Firefox's
 * `root________`) is rejected as a parent by both engines — the same
 * constraint documented in `src/features/settings/import-target.ts` — so this
 * returns a real child folder instead: the bookmarks bar when it can be
 * identified, otherwise the first child folder there is. Returns `null` when
 * there is no such folder to create under.
 */
export function resolveDefaultCreateParentId(
  tree: BookmarkNode[]
): string | null {
  const root = tree[0]
  if (!root) return null

  const childFolders = (root.children ?? []).filter(
    (child) => child.url === undefined
  )

  const bookmarksBar = childFolders.find((child) =>
    BOOKMARKS_BAR_IDS.includes(child.id)
  )

  // The fallback matters for anything that is neither Chrome nor Firefox
  // shaped — a Chromium fork that renumbers its roots, or a test fixture.
  return (bookmarksBar ?? childFolders[0])?.id ?? null
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

function containsNode(nodes: BookmarkNode[], id: string): boolean {
  return nodes.some(
    (node) => node.id === id || containsNode(node.children ?? [], id)
  )
}

/**
 * Resolves where a create — or an import — should write, honouring the
 * dashboard root when there is one.
 *
 * The saved root id is verified against the tree rather than trusted. It is
 * persisted separately from the bookmarks themselves, so a folder deleted in
 * the browser (or in the vault, by another client) leaves the id behind
 * pointing at nothing; using it would send every write to a parent that does
 * not exist and fail the lot. Falling back is strictly better than failing.
 */
export function resolveCreateParentId(
  tree: BookmarkNode[],
  rootFolderId: string | null,
  rootIsCreatable: boolean
): string | null {
  if (rootFolderId && containsNode(tree, rootFolderId)) return rootFolderId
  return resolveEffectiveCreateParentId(tree, rootIsCreatable)
}
