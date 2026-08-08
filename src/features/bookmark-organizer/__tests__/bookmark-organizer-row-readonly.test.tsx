// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { BookmarkOrganizerRow } from "../bookmark-organizer-row"
import type { OrganizerItemData } from "../bookmark-organizer-types"
import type { ItemInstance } from "@headless-tree/core"

afterEach(() => {
  cleanup()
})

function fakeItem(data: OrganizerItemData): ItemInstance<OrganizerItemData> {
  return {
    getItemData: () => data,
    isFolder: () => data.kind === "folder",
    isExpanded: () => false,
    isUnorderedDragTarget: () => false,
    getItemName: () => data.title,
    getItemMeta: () => ({ level: 0 }),
    getProps: () => ({}),
    getDragHandleProps: () => ({}),
  } as unknown as ItemInstance<OrganizerItemData>
}

describe("BookmarkOrganizerRow read-only affordances", () => {
  it("disables rename/delete and hides the drag handle for a read-only item", () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()

    const readOnlyItem = fakeItem({
      id: "b1",
      title: "Example",
      kind: "bookmark",
      parentId: "root",
      index: 0,
      childCount: 0,
      readOnly: true,
      diagnostics: [
        {
          code: "invalid_id",
          severity: "error",
          detail: "bookmarks_but_better_id is missing.",
        },
      ],
    })

    render(
      <BookmarkOrganizerRow
        item={readOnlyItem}
        isDragging={false}
        dragEnabled={true}
        onRename={onRename}
        onDelete={onDelete}
        onCreateItem={() => {}}
      />
    )

    const renameButton = screen.getByRole("button", { name: /rename/i })
    expect(renameButton.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(renameButton)
    expect(onRename).not.toHaveBeenCalled()

    const deleteButton = screen.getByRole("button", { name: /delete/i })
    expect(deleteButton.getAttribute("aria-disabled")).toBe("true")
    fireEvent.click(deleteButton)
    expect(onDelete).not.toHaveBeenCalled()

    expect(screen.queryByRole("button", { name: "Drag item" })).toBeNull()
  })

  it("keeps rename/delete/drag active for an editable item", () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()

    const editableItem = fakeItem({
      id: "b2",
      title: "Example",
      kind: "bookmark",
      parentId: "root",
      index: 0,
      childCount: 0,
    })

    render(
      <BookmarkOrganizerRow
        item={editableItem}
        isDragging={false}
        dragEnabled={true}
        onRename={onRename}
        onDelete={onDelete}
        onCreateItem={() => {}}
      />
    )

    fireEvent.click(screen.getByRole("button", { name: "Rename item" }))
    expect(onRename).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole("button", { name: "Delete item" }))
    expect(onDelete).toHaveBeenCalledTimes(1)

    expect(screen.getByRole("button", { name: "Drag item" })).toBeTruthy()
  })

  /**
   * `orderReadOnly` is deliberately not `readOnly`: the daemon refuses only
   * *positional* requests against such a folder, so everything else about the
   * row has to keep working.
   */
  it("marks a frozen-order folder without disabling anything else about it", () => {
    const onRename = vi.fn()
    const onDelete = vi.fn()

    const frozenFolder = fakeItem({
      id: "f1",
      title: "Frozen",
      kind: "folder",
      parentId: "root",
      index: 0,
      childCount: 2,
      orderReadOnly: true,
      diagnostics: [
        {
          code: "state_unknown_keys",
          severity: "warning",
          detail: "The order file was written by a newer version.",
        },
      ],
    })

    render(
      <BookmarkOrganizerRow
        item={frozenFolder}
        isDragging={false}
        dragEnabled={true}
        onRename={onRename}
        onDelete={onDelete}
        onCreateItem={() => {}}
      />
    )

    expect(screen.getByLabelText("Fixed order")).toBeTruthy()

    // The folder itself can still move, be renamed and be deleted.
    expect(screen.getByRole("button", { name: "Drag item" })).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Rename item" }))
    expect(onRename).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: "Delete item" }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(screen.getByRole("button", { name: "Add item" })).toBeTruthy()
  })

  it("shows no frozen-order marker on an ordinary folder", () => {
    const folder = fakeItem({
      id: "f2",
      title: "Normal",
      kind: "folder",
      parentId: "root",
      index: 0,
      childCount: 0,
    })

    render(
      <BookmarkOrganizerRow
        item={folder}
        isDragging={false}
        dragEnabled={true}
        onRename={() => {}}
        onDelete={() => {}}
        onCreateItem={() => {}}
      />
    )

    expect(screen.queryByLabelText("Fixed order")).toBeNull()
  })

  it("hides the drag handle for an editable item when reorder is disabled adapter-wide", () => {
    const editableItem = fakeItem({
      id: "b3",
      title: "Example",
      kind: "bookmark",
      parentId: "root",
      index: 0,
      childCount: 0,
    })

    render(
      <BookmarkOrganizerRow
        item={editableItem}
        isDragging={false}
        dragEnabled={false}
        onRename={() => {}}
        onDelete={() => {}}
        onCreateItem={() => {}}
      />
    )

    expect(screen.queryByRole("button", { name: "Drag item" })).toBeNull()
  })
})
