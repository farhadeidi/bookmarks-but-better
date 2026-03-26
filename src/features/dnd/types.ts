export const DND_TYPE = {
  BOOKMARK: "bookmark",
  FOLDER_CARD: "folder-card",
} as const

export interface BookmarkDragData {
  type: typeof DND_TYPE.BOOKMARK
  id: string
  folderId: string
  index: number
}

export interface FolderCardDragData {
  type: typeof DND_TYPE.FOLDER_CARD
  id: string
  index: number
}

export type DragData = BookmarkDragData | FolderCardDragData
