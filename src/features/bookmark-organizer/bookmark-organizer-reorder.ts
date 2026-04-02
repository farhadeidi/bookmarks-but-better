import type { OrganizerItemData } from "./bookmark-organizer-types"

export type SequentialMove = {
  id: string
  parentId: string | null
  index: number
}

export function buildSequentialMoves(
  items: OrganizerItemData[],
  parentId: string | null
): SequentialMove[] {
  return items.map((item, index) => ({
    id: item.id,
    parentId,
    index,
  }))
}

export function getBranchIdsToRefresh(params: {
  sourceParentId: string | null
  destinationParentId: string | null
  movedId: string
}): string[] {
  const ids: string[] = []

  for (const id of [
    params.sourceParentId,
    params.destinationParentId,
    params.movedId,
  ]) {
    if (id && !ids.includes(id)) {
      ids.push(id)
    }
  }

  return ids
}
