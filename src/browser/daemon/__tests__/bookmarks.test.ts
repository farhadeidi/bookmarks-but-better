import { afterEach, describe, expect, it, vi } from "vitest"
import type { BookmarkNode } from "../../types"

vi.mock("../sse", () => ({
  connectDaemonEvents: vi.fn(() => vi.fn()),
}))

vi.mock("../client", () => ({
  fetchTree: vi.fn(),
  fetchNode: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  moveNode: vi.fn(),
  fetchHealth: vi.fn(),
}))

import { DaemonBookmarkAdapter } from "../bookmarks"
import * as client from "../client"

const root: BookmarkNode = {
  id: "root",
  title: "Vault",
  revision: "rev-root",
  children: [
    {
      id: "folder-a",
      title: "Folder A",
      parentId: "root",
      revision: "rev-a",
      children: [
        {
          id: "bookmark-1",
          title: "Example",
          url: "https://example.com",
          parentId: "folder-a",
          revision: "rev-1",
        },
      ],
    },
  ],
}

afterEach(() => {
  vi.clearAllMocks()
})

describe("DaemonBookmarkAdapter", () => {
  it("getTree() reads {tree} and returns it directly, indexing revisions", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter()

    const tree = await adapter.getTree()

    expect(tree).toEqual([root])
  })

  it("routes create() to /folders when no url is given and to /bookmarks otherwise", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    vi.mocked(client.createNode).mockResolvedValue({
      id: "new-folder",
      title: "New Folder",
      parentId: "root",
      revision: "rev-new-folder",
    })
    await adapter.create({ parentId: "root", title: "New Folder" })
    expect(client.createNode).toHaveBeenCalledWith(
      "folder",
      expect.objectContaining({ title: "New Folder" })
    )

    vi.mocked(client.createNode).mockResolvedValue({
      id: "new-bookmark",
      title: "New Bookmark",
      url: "https://a.test",
      parentId: "root",
      revision: "rev-new-bookmark",
    })
    await adapter.create({
      parentId: "root",
      title: "New Bookmark",
      url: "https://a.test",
    })
    expect(client.createNode).toHaveBeenCalledWith(
      "bookmark",
      expect.objectContaining({ url: "https://a.test" })
    )
  })

  it("notifies its own listeners on a successful mutation, without needing SSE", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    const onCreated = vi.fn()
    adapter.onCreated(onCreated)

    vi.mocked(client.createNode).mockResolvedValue({
      id: "new-bookmark",
      title: "New Bookmark",
      url: "https://a.test",
      parentId: "root",
      revision: "rev-new-bookmark",
    })
    await adapter.create({
      parentId: "root",
      title: "New Bookmark",
      url: "https://a.test",
    })

    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it("update() targets /bookmarks/:id with no kind argument, even for a folder, and updates the cached revision", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    // "root" is a folder (no url) — update() must not route it to /folders.
    vi.mocked(client.updateNode).mockResolvedValue({
      ...root,
      title: "Renamed Vault",
      revision: "rev-root-2",
    })
    await adapter.update("root", { title: "Renamed Vault" })
    expect(client.updateNode).toHaveBeenCalledWith("root", {
      revision: "rev-root",
      title: "Renamed Vault",
    })

    // A second update must use the *new* revision, proving the cache updated.
    vi.mocked(client.updateNode).mockResolvedValue({
      ...root,
      title: "Renamed again",
      revision: "rev-root-3",
    })
    await adapter.update("root", { title: "Renamed again" })
    expect(client.updateNode).toHaveBeenLastCalledWith("root", {
      revision: "rev-root-2",
      title: "Renamed again",
    })
  })

  it("throws instead of guessing when asked to mutate an id it has never seen", async () => {
    const adapter = new DaemonBookmarkAdapter()
    await expect(adapter.update("missing", { title: "x" })).rejects.toThrow(
      /unknown node/i
    )
  })

  it("getSubTree() fetches a bare DTO from /bookmarks/:id and merges into the cache without evicting other branches", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    // A lazy per-folder load of an unrelated branch must not forget about
    // `bookmark-1`, which getTree() already cached.
    vi.mocked(client.fetchNode).mockResolvedValue({
      id: "folder-b",
      title: "Folder B",
      parentId: "root",
      revision: "rev-b",
      children: [],
    })
    const [node] = await adapter.getSubTree("folder-b")
    expect(client.fetchNode).toHaveBeenCalledWith("folder-b")
    expect(node.title).toBe("Folder B")

    vi.mocked(client.updateNode).mockResolvedValue({
      id: "bookmark-1",
      title: "Still known",
      url: "https://example.com",
      parentId: "folder-a",
      revision: "rev-1-b",
    })
    await expect(
      adapter.update("bookmark-1", { title: "Still known" })
    ).resolves.toBeTruthy()
  })

  it("move() no-ops when there is no destination parent (nothing to do without reorder support)", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    await adapter.move("bookmark-1", { index: 0 })
    expect(client.moveNode).not.toHaveBeenCalled()
  })

  it("move() targets /bookmarks/:id with no kind argument, sending only revision and parentId, and refreshes the cache from the response", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    // The daemon's move handler returns the moved entry's BookmarkDto (a
    // real 200 body, not an empty 204) — that's what the cache refreshes from.
    vi.mocked(client.moveNode).mockResolvedValue({
      ...root,
      parentId: "folder-other",
      revision: "rev-root-moved",
    })
    // Move the *folder* "root" — proves move() doesn't route by kind either.
    await adapter.move("root", { parentId: "folder-other", index: 3 })

    expect(client.moveNode).toHaveBeenCalledWith("root", {
      revision: "rev-root",
      parentId: "folder-other",
    })

    // Proof the cache refreshed: a follow-up update must send the *new*
    // revision from the move response, not the pre-move one.
    vi.mocked(client.updateNode).mockResolvedValue({
      ...root,
      title: "Renamed after move",
      revision: "rev-root-moved-2",
    })
    await adapter.update("root", { title: "Renamed after move" })
    expect(client.updateNode).toHaveBeenCalledWith("root", {
      revision: "rev-root-moved",
      title: "Renamed after move",
    })
  })

  it("remove() keeps kind routing: deletes with the cached revision and evicts the node from the cache", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    vi.mocked(client.deleteNode).mockResolvedValue(undefined)
    await adapter.remove("bookmark-1")

    expect(client.deleteNode).toHaveBeenCalledWith(
      "bookmark",
      "bookmark-1",
      "rev-1"
    )
    await expect(adapter.remove("bookmark-1")).rejects.toThrow(/unknown node/i)
  })

  it("removeTree() deletes a folder with recursive:true", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    vi.mocked(client.deleteNode).mockResolvedValue(undefined)
    await adapter.removeTree("folder-a")

    expect(client.deleteNode).toHaveBeenCalledWith(
      "folder",
      "folder-a",
      "rev-a",
      { recursive: true }
    )
  })

  it("checkHealth() reports readiness and passes through warnings as diagnostic objects", async () => {
    const warnings = [
      {
        code: "unreadable_path",
        severity: "error",
        detail: "3 files could not be parsed.",
      },
    ]
    vi.mocked(client.fetchHealth).mockResolvedValue({
      status: "degraded",
      warnings,
    })
    const adapter = new DaemonBookmarkAdapter()

    await expect(adapter.checkHealth?.()).resolves.toEqual({
      ready: false,
      warnings,
    })
  })

  it("dispose() closes the underlying event connection", async () => {
    const sse = await import("../sse")
    const disconnect = vi.fn()
    vi.mocked(sse.connectDaemonEvents).mockReturnValue(disconnect)

    const adapter = new DaemonBookmarkAdapter()
    adapter.dispose()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
