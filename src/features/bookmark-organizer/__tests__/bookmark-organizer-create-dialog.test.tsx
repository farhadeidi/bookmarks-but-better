// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { BookmarkOrganizerCreateDialog } from "../bookmark-organizer-create-dialog"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"

describe("BookmarkOrganizerCreateDialog", () => {
  beforeEach(() => {
    useUIStore.setState({
      creatingItem: null,
    })
    useBookmarkStore.setState({
      createFolder: vi.fn().mockResolvedValue(undefined),
      createBookmark: vi.fn().mockResolvedValue(undefined),
    })
  })

  it("creates a folder from the organizer create dialog", async () => {
    const user = userEvent.setup()
    const createFolder = vi.fn().mockResolvedValue(undefined)
    const closeCreateItem = vi.fn(() => {
      useUIStore.setState({ creatingItem: null })
    })

    useBookmarkStore.setState({ createFolder })
    useUIStore.setState({
      creatingItem: { type: "folder", parentId: "parent-1" },
      closeCreateItem,
    })

    render(<BookmarkOrganizerCreateDialog />)

    expect(await screen.findByRole("dialog", { name: "New Folder" })).toBeTruthy()
    expect(screen.getByLabelText("Title")).toBeTruthy()
    expect(screen.queryByLabelText("URL")).toBeNull()

    await user.type(screen.getByLabelText("Title"), "  New folder  ")
    await user.click(screen.getByRole("button", { name: "Create" }))

    await waitFor(() => {
      expect(createFolder).toHaveBeenCalledWith("parent-1", "New folder")
      expect(closeCreateItem).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("creates a bookmark from the organizer create dialog", async () => {
    const user = userEvent.setup()
    const createBookmark = vi.fn().mockResolvedValue(undefined)
    const closeCreateItem = vi.fn(() => {
      useUIStore.setState({ creatingItem: null })
    })

    useBookmarkStore.setState({ createBookmark })
    useUIStore.setState({
      creatingItem: { type: "bookmark", parentId: "parent-2" },
      closeCreateItem,
    })

    render(<BookmarkOrganizerCreateDialog />)

    expect(await screen.findByRole("dialog", { name: "New Bookmark" })).toBeTruthy()
    expect(screen.getByLabelText("Title")).toBeTruthy()
    expect(screen.getByLabelText("URL")).toBeTruthy()

    await user.type(screen.getByLabelText("Title"), "  New bookmark  ")
    await user.type(screen.getByLabelText("URL"), "https://example.com")
    fireEvent.click(screen.getByRole("button", { name: "Create" }))

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalledWith(
        "parent-2",
        "New bookmark",
        "https://example.com"
      )
      expect(closeCreateItem).toHaveBeenCalledTimes(1)
    })
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})
