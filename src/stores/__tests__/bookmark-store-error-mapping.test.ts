import { beforeEach, describe, expect, it, vi } from "vitest"
import { useBookmarkStore } from "../bookmark-store"
import type { BrowserAdapter } from "@/browser"

function baseAdapter(
  overrides: Partial<BrowserAdapter["bookmarks"]> = {}
): BrowserAdapter {
  return {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue([]),
      getSubTree: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      onChanged: vi.fn(() => () => {}),
      onCreated: vi.fn(() => () => {}),
      onRemoved: vi.fn(() => () => {}),
      onMoved: vi.fn(() => () => {}),
      openInManager: vi.fn(),
      ...overrides,
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    favicon: { getUrl: vi.fn(() => ""), isAvailable: vi.fn(() => false) },
    capabilities: { openInManager: false, move: true, reorder: false },
  }
}

describe("bookmark-store actionable mutation errors", () => {
  beforeEach(() => {
    useBookmarkStore.setState({ mutationError: null })
  })

  it("maps a 409 conflict into an actionable refresh-and-retry message", async () => {
    class ConflictError extends Error {
      status = 409
    }
    const adapter = baseAdapter({
      update: vi
        .fn()
        .mockRejectedValue(new ConflictError("Revision mismatch.")),
    })
    useBookmarkStore.setState({ adapter })

    await useBookmarkStore.getState().updateBookmark("id-1", { title: "New" })

    expect(useBookmarkStore.getState().mutationError).toBe(
      "This item changed elsewhere. Refresh and try again."
    )
  })

  it("maps a read_only rejection into an actionable, detail-carrying message", async () => {
    class ReadOnlyError extends Error {
      code = "read_only"
      detail = "bbb_id is missing."
    }
    const adapter = baseAdapter({
      update: vi.fn().mockRejectedValue(new ReadOnlyError("Cannot edit.")),
    })
    useBookmarkStore.setState({ adapter })

    await useBookmarkStore.getState().updateBookmark("id-1", { title: "New" })

    expect(useBookmarkStore.getState().mutationError).toBe(
      "This item is read-only: bbb_id is missing."
    )
  })

  it("falls back to the plain message for adapters with no status/code (chrome/firefox/standalone)", async () => {
    const adapter = baseAdapter({
      update: vi.fn().mockRejectedValue(new Error("Something else broke.")),
    })
    useBookmarkStore.setState({ adapter })

    await useBookmarkStore.getState().updateBookmark("id-1", { title: "New" })

    expect(useBookmarkStore.getState().mutationError).toBe(
      "Something else broke."
    )
  })
})
