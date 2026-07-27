import type { BookmarkDiagnostic } from "@/browser"

export type OrganizerItemData = {
  id: string
  title: string
  kind: "folder" | "bookmark"
  parentId: string | null
  index: number
  childCount: number
  readOnly?: boolean
  diagnostics?: BookmarkDiagnostic[]
}

export const BOOKMARK_ORGANIZER_ROOT_ID = "bookmark-organizer-root"
