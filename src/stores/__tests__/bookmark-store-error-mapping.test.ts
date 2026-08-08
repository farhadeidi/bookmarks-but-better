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
    capabilities: {
      openInManager: false,
      move: true,
      reorder: false,
      setChildOrder: false,
    },
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
      new DaemonLikeError(
        "read_only",
        "Unprocessable",
        "bookmarks_but_better_id is missing."
      )
    )
    expect(message).toBe(
      "This item is read-only and can't be edited. bookmarks_but_better_id is missing."
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

  it("maps stale_state_revision to a refresh-and-retry message about the folder's order", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError(
        "stale_state_revision",
        "Conflict",
        "Reload the folder and retry."
      )
    )
    // Deliberately distinct from `stale_revision`: the item is fine, its
    // sibling order is what moved underneath us.
    expect(message).toBe(
      "This folder's order changed elsewhere. Refresh and try again. Reload the folder and retry."
    )
  })

  it("maps state_read_only to a message that says what still works", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError("state_read_only", "Unprocessable")
    )
    expect(message).toBe(
      "This folder's order can't be changed, but its items can still be renamed, moved and deleted."
    )
  })

  it("maps invalid_order to a refresh-and-retry message", async () => {
    const message = await mutateAndGetError(
      new DaemonLikeError(
        "invalid_order",
        "Unprocessable",
        "`x` is not a child of this folder."
      )
    )
    expect(message).toBe(
      "This folder's contents changed. Refresh and try again. `x` is not a child of this folder."
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

/**
 * Unlike every other mutation action, these two report success inline. A drop
 * handler has to decide whether to keep going *during* the gesture, and
 * reading `mutationError` afterwards can't distinguish "this drop failed" from
 * "a previous one did".
 */
describe("bookmark-store ordering actions report success inline", () => {
  beforeEach(() => {
    useBookmarkStore.setState({ mutationError: null })
  })

  it("setChildOrder resolves true and clears the error on success", async () => {
    const setChildOrder = vi.fn().mockResolvedValue(undefined)
    const adapter = baseAdapter({ setChildOrder })
    useBookmarkStore.setState({ adapter, mutationError: "stale message" })

    await expect(
      useBookmarkStore.getState().setChildOrder("folder-1", ["a", "b"])
    ).resolves.toBe(true)
    expect(setChildOrder).toHaveBeenCalledWith("folder-1", ["a", "b"])
    expect(useBookmarkStore.getState().mutationError).toBeNull()
  })

  it("setChildOrder resolves false and surfaces a friendly message on refusal", async () => {
    const adapter = baseAdapter({
      setChildOrder: vi
        .fn()
        .mockRejectedValue(
          new DaemonLikeError("stale_state_revision", "Conflict")
        ),
    })
    useBookmarkStore.setState({ adapter, mutationError: null })

    await expect(
      useBookmarkStore.getState().setChildOrder("folder-1", ["a", "b"])
    ).resolves.toBe(false)
    expect(useBookmarkStore.getState().mutationError).toBe(
      "This folder's order changed elsewhere. Refresh and try again."
    )
  })

  it("setChildOrder resolves false when the adapter cannot order at all", async () => {
    // Chrome/Firefox/Standalone leave the optional method undefined.
    const adapter = baseAdapter()
    useBookmarkStore.setState({ adapter, mutationError: null })

    await expect(
      useBookmarkStore.getState().setChildOrder("folder-1", ["a"])
    ).resolves.toBe(false)
  })

  it("moveBookmark reports whether the move landed", async () => {
    const ok = baseAdapter({ move: vi.fn().mockResolvedValue(undefined) })
    useBookmarkStore.setState({ adapter: ok, mutationError: null })
    await expect(
      useBookmarkStore.getState().moveBookmark("b1", { index: 0 })
    ).resolves.toBe(true)

    const failing = baseAdapter({
      move: vi.fn().mockRejectedValue(new DaemonLikeError("read_only", "Nope")),
    })
    useBookmarkStore.setState({ adapter: failing, mutationError: null })
    await expect(
      useBookmarkStore.getState().moveBookmark("b1", { index: 0 })
    ).resolves.toBe(false)
    expect(useBookmarkStore.getState().mutationError).toBe(
      "This item is read-only and can't be edited."
    )
  })
})
