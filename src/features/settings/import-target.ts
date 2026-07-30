/**
 * Resolves the folder id that imported bookmarks should be written under.
 *
 * There is no universally valid "root" id to fall back to: "0" happens to be
 * Chrome's invisible tree-root id, which chrome.bookmarks.create() rejects
 * as a parent, and it does not correspond to any real folder in Firefox or
 * the standalone adapter. Importing without a selected root folder must fail
 * clearly instead of silently writing bookmarks nowhere (standalone) or
 * throwing an adapter-level error the user can't make sense of (Chrome).
 */
export function resolveImportRootId(rootFolderId: string | null): string {
  if (!rootFolderId) {
    throw new Error(
      "Choose a root folder in Settings before importing bookmarks."
    )
  }
  return rootFolderId
}
