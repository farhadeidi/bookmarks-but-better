import { afterEach, describe, expect, it, vi } from "vitest"
import type { BookmarkNode } from "../../types"

vi.mock("../sse", () => ({
  connectDaemonEvents: vi.fn(() => vi.fn()),
}))

vi.mock("../client", () => ({
  fetchTree: vi.fn(),
  fetchSubTree: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  moveNode: vi.fn(),
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
  it("getTree wraps the daemon's single vault root in an array and indexes revisions", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ root })
    const adapter = new DaemonBookmarkAdapter()

    const tree = await adapter.getTree()

    expect(tree).toEqual([root])
  })

  it("routes create() to /folders when no url is given and to /bookmarks otherwise", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ root })
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
    vi.mocked(client.fetchTree).mockResolvedValue({ root })
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

  it("update() sends the cached revision and updates it from the response", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ root })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    vi.mocked(client.updateNode).mockResolvedValue({
      id: "bookmark-1",
      title: "Renamed",
      url: "https://example.com",
      parentId: "folder-a",
      revision: "rev-1-b",
    })

    await adapter.update("bookmark-1", { title: "Renamed" })

    expect(client.updateNode).toHaveBeenCalledWith("bookmark", "bookmark-1", {
      revision: "rev-1",
      title: "Renamed",
    })

    // A second update must use the *new* revision, proving the cache updated.
    vi.mocked(client.updateNode).mockResolvedValue({
      id: "bookmark-1",
      title: "Renamed again",
      url: "https://example.com",
      parentId: "folder-a",
      revision: "rev-1-c",
    })
    await adapter.update("bookmark-1", { title: "Renamed again" })
    expect(client.updateNode).toHaveBeenLastCalledWith(
      "bookmark",
      "bookmark-1",
      { revision: "rev-1-b", title: "Renamed again" }
    )
  })

  it("throws instead of guessing when asked to mutate an id it has never seen", async () => {
    const adapter = new DaemonBookmarkAdapter()
    await expect(adapter.update("missing", { title: "x" })).rejects.toThrow(
      /unknown node/i
    )
  })

  it("getSubTree merges into the cache without evicting other branches", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ root })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    // A lazy per-folder load of an unrelated branch must not forget about
    // `bookmark-1`, which getTree() already cached.
    vi.mocked(client.fetchSubTree).mockResolvedValue({
      node: {
        id: "folder-b",
        title: "Folder B",
        parentId: "root",
        revision: "rev-b",
        children: [],
      },
    })
    await adapter.getSubTree("folder-b")

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
    vi.mocked(client.fetchTree).mockResolvedValue({ root })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    await adapter.move("bookmark-1", { index: 0 })
    expect(client.moveNode).not.toHaveBeenCalled()
  })

  it("move() sends only revision and parentId, ignoring index", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ root })
    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree()

    vi.mocked(client.moveNode).mockResolvedValue(undefined)
    await adapter.move("bookmark-1", { parentId: "folder-other", index: 3 })

    expect(client.moveNode).toHaveBeenCalledWith("bookmark", "bookmark-1", {
      revision: "rev-1",
      parentId: "folder-other",
    })
  })

  it("remove() deletes with the cached revision and evicts the node from the cache", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ root })
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

  it("dispose() closes the underlying event connection", async () => {
    const sse = await import("../sse")
    const disconnect = vi.fn()
    vi.mocked(sse.connectDaemonEvents).mockReturnValue(disconnect)

    const adapter = new DaemonBookmarkAdapter()
    adapter.dispose()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
