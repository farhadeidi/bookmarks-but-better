// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
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

  // This project has no global auto-cleanup, so a rendered dialog otherwise
  // survives into the next test and duplicates every query.
  afterEach(cleanup)

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

    expect(
      await screen.findByRole("dialog", { name: "New Folder" })
    ).toBeTruthy()
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

    expect(
      await screen.findByRole("dialog", { name: "New Bookmark" })
    ).toBeTruthy()
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

  it("disables Create until the folder has a title", async () => {
    const user = userEvent.setup()
    useUIStore.setState({
      creatingItem: { type: "folder", parentId: "parent-1" },
    })

    render(<BookmarkOrganizerCreateDialog />)

    const create = await screen.findByRole("button", { name: "Create" })
    expect((create as HTMLButtonElement).disabled).toBe(true)

    await user.type(screen.getByLabelText("Title"), "Something")
    expect((create as HTMLButtonElement).disabled).toBe(false)

    await user.clear(screen.getByLabelText("Title"))
    expect((create as HTMLButtonElement).disabled).toBe(true)
  })

  it("keeps Create disabled for a bookmark until both fields are filled", async () => {
    const user = userEvent.setup()
    useUIStore.setState({
      creatingItem: { type: "bookmark", parentId: "parent-2" },
    })

    render(<BookmarkOrganizerCreateDialog />)

    const create = await screen.findByRole("button", { name: "Create" })

    await user.type(screen.getByLabelText("Title"), "Title only")
    expect((create as HTMLButtonElement).disabled).toBe(true)

    await user.type(screen.getByLabelText("URL"), "https://example.com")
    expect((create as HTMLButtonElement).disabled).toBe(false)
  })

  it("explains an empty field once the user has left it", async () => {
    const user = userEvent.setup()
    useUIStore.setState({
      creatingItem: { type: "folder", parentId: "parent-1" },
    })

    render(<BookmarkOrganizerCreateDialog />)
    await screen.findByLabelText("Title")

    expect(screen.queryByText("A title is required.")).toBeNull()

    await user.click(screen.getByLabelText("Title"))
    await user.tab()

    expect(screen.getByText("A title is required.")).toBeTruthy()
  })

  it("submits a bookmark on Enter, which the two-field form used to ignore", async () => {
    const user = userEvent.setup()
    const createBookmark = vi.fn().mockResolvedValue(undefined)
    useBookmarkStore.setState({ createBookmark })
    useUIStore.setState({
      creatingItem: { type: "bookmark", parentId: "parent-2" },
      closeCreateItem: vi.fn(),
    })

    render(<BookmarkOrganizerCreateDialog />)

    await user.type(await screen.findByLabelText("Title"), "Typed")
    await user.type(screen.getByLabelText("URL"), "https://example.com{Enter}")

    await waitFor(() => {
      expect(createBookmark).toHaveBeenCalledWith(
        "parent-2",
        "Typed",
        "https://example.com"
      )
    })
  })
})
