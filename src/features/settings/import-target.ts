import type { BookmarkNode } from "@/browser"
import { resolveCreateParentId } from "@/features/root-folder-select"

/**
 * Resolves the folder an import should default to writing under.
 *
 * The dashboard root is the obvious answer when there is one — and when it
 * still exists; a saved id that no longer resolves is treated as absent rather
 * than used, since importing into a deleted folder fails every single write.
 *
 * When there is no usable root, importing must still work: a root folder is
 * meaningless in daemon and standalone mode, where the tree root is itself a
 * real, writable folder, so refusing the whole import until the user picks one
 * (as this module used to) locked those modes out of importing entirely.
 * Falling back to the same parent the create buttons use keeps every mode
 * consistent.
 *
 * Returns `null` only when there is genuinely nowhere to write — an empty tree
 * with a browser adapter, whose synthetic root is not a valid parent.
 */
export function resolveDefaultImportParentId(
  tree: BookmarkNode[],
  rootFolderId: string | null,
  rootIsCreatable: boolean
): string | null {
  return resolveCreateParentId(tree, rootFolderId, rootIsCreatable)
}
