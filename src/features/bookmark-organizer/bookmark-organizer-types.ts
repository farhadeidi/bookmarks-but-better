export type OrganizerItemData = {
  id: string
  title: string
  kind: "folder" | "bookmark"
  parentId: string | null
  index: number
  childCount: number
}

export const BOOKMARK_ORGANIZER_ROOT_ID = "bookmark-organizer-root"
