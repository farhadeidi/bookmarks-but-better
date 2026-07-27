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

class DaemonLikeError extends Error {
  code: string
  detail?: string

  constructor(code: string, message: string, detail?: string) {
    super(message)
    this.code = code
    this.detail = detail
  }
}

async function mutateAndGetError(error: Error): Promise<string | null> {
  const adapter = baseAdapter({ update: vi.fn().mockRejectedValue(error) })
  useBookmarkStore.setState({ adapter, mutationError: null })
  await useBookmarkStore.getState().updateBookmark("id-1", { title: "New" })
  return useBookmarkStore.getState().mutationError
}

describe("bookmark-store actionable mutation errors", () => {
  beforeEach(() => {
    useBookmarkStore.setState({ mutationError: null })
  })

  it("maps stale_revision to a refresh-and-retry message, preserving server detail", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError(
        "stale_revision",
        "Conflict",
        "The file changed on disk."
      )
    )
    expect(message).toBe(
      "This item changed elsewhere. Refresh and try again. The file changed on disk."
    )
  })

  it("maps subtree_changed to a rescan-and-retry message", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError("subtree_changed", "Conflict")
    )
    expect(message).toBe(
      "This folder changed while being deleted. Rescan and try again."
    )
  })

  it("maps subtree_has_unknown_files to an explanation that unmanaged files block a safe delete", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError(
        "subtree_has_unknown_files",
        "Conflict",
        "notes/scratch.txt is not a managed bookmark."
      )
    )
    expect(message).toBe(
      "This folder contains files the vault doesn't manage, so deleting it isn't safe. notes/scratch.txt is not a managed bookmark."
    )
  })

  it("maps folder_not_empty to a message asking for a recursive delete", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError("folder_not_empty", "Conflict")
    )
    expect(message).toBe(
      "This folder isn't empty. Delete it recursively to remove its contents too."
    )
  })

  it("maps ambiguous_id to an actionable message carrying the server detail", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError(
        "ambiguous_id",
        "Conflict",
        "Two entries claim id a1b2c3d4."
      )
    )
    expect(message).toBe(
      "More than one item matches this reference. Two entries claim id a1b2c3d4."
    )
  })

  it("maps read_only to an actionable message carrying the server detail", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError("read_only", "Unprocessable", "bbb_id is missing.")
    )
    expect(message).toBe(
      "This item is read-only and can't be edited. bbb_id is missing."
    )
  })

  it("maps partial_failure to an actionable message carrying the server detail", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError(
        "partial_failure",
        "Internal error",
        "3 of 5 files were moved before the failure."
      )
    )
    expect(message).toBe(
      "The change was only partly applied. 3 of 5 files were moved before the failure."
    )
  })

  it("does not treat every 409 as a conflict — an unmapped code falls back to the plain message", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError("move_into_self", "Cannot move a folder into itself")
    )
    expect(message).toBe("Cannot move a folder into itself")
  })

  it("falls back to the plain message for adapters with no code at all (chrome/firefox/standalone)", async () => {
    const message = await mutateAndGetError(new Error("Something else broke."))
    expect(message).toBe("Something else broke.")
  })
})
