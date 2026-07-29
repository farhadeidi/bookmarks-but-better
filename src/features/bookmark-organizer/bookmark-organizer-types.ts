import type { BookmarkDiagnostic } from "@/browser"

export type OrganizerItemData = {
  id: string
  title: string
  kind: "folder" | "bookmark"
  parentId: string | null
  index: number
  childCount: number
  readOnly?: boolean
  /**
   * Folders only: the folder's child order is frozen, so items can't be
   * repositioned inside it. Everything else about it stays editable.
   */
  orderReadOnly?: boolean
  diagnostics?: BookmarkDiagnostic[]
}

export const BOOKMARK_ORGANIZER_ROOT_ID = "bookmark-organizer-root"
