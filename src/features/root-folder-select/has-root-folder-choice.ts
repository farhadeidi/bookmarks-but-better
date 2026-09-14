import type { BookmarkNode } from "@/browser"
import { buildRootFolderOptions } from "./root-folder-options"
import { resolveEffectiveCreateParentId } from "./default-parent"

/**
 * Whether pointing the dashboard at a folder is a question at all here.
 *
 * It is one only where the tree offers somewhere to point: a folder to
 * select, or a real parent to create one under. With neither — an empty
 * tree, or a daemon-only profile that has not connected anything yet — the
 * picker's only entry is "all bookmarks", which is exactly what choosing
 * nothing already means, so offering the picker would be a dead end rather
 * than a decision.
 *
 * Shared by the onboarding wizard (skips its Root folder step) and the new
 * tab's root-folder control (hides itself) so both agree on when there is
 * nothing to choose.
 */
export function hasRootFolderChoice(
  tree: BookmarkNode[],
  rootIsCreatable: boolean
): boolean {
  return (
    buildRootFolderOptions(tree).length > 0 ||
    resolveEffectiveCreateParentId(tree, rootIsCreatable) !== null
  )
}
