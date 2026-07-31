import { afterEach, describe, expect, it, vi } from "vitest"
import type { BookmarkNode } from "../../types"

vi.mock("../sse", () => ({
  connectDaemonEvents: vi.fn(() => vi.fn()),
}))

import { DaemonBookmarkAdapter } from "../bookmarks"
import type { DaemonClient } from "../client"

/**
 * The adapter is handed a client rather than importing one, so the double is
 * a plain object with the same method names -- no module mock, and nothing
 * here can accidentally reach a real origin.
 */
const client = {
  fetchTree: vi.fn(),
  fetchNode: vi.fn(),
  createNode: vi.fn(),
  updateNode: vi.fn(),
  deleteNode: vi.fn(),
  moveNode: vi.fn(),
  setOrder: vi.fn(),
  fetchHealth: vi.fn(),
  eventsUrl: "/api/v1/events",
  authHeaders: () => ({}),
} as unknown as DaemonClient

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
    const adapter = new DaemonBookmarkAdapter({ client })

    const tree = await adapter.getTree()

    expect(tree).toEqual([root])
  })

  it("routes create() to /folders when no url is given and to /bookmarks otherwise", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter({ client })
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
    const adapter = new DaemonBookmarkAdapter({ client })
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
    const adapter = new DaemonBookmarkAdapter({ client })
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
    const adapter = new DaemonBookmarkAdapter({ client })
    await expect(adapter.update("missing", { title: "x" })).rejects.toThrow(
      /unknown node/i
    )
  })

  it("getSubTree() fetches a bare DTO from /bookmarks/:id and merges into the cache without evicting other branches", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter({ client })
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
    const adapter = new DaemonBookmarkAdapter({ client })
    await adapter.getTree()

    await adapter.move("bookmark-1", { index: 0 })
    expect(client.moveNode).not.toHaveBeenCalled()
  })

  it("move() targets /bookmarks/:id with no kind argument, sending only revision and parentId, and refreshes the cache from the response", async () => {
    vi.mocked(client.fetchTree).mockResolvedValue({ tree: [root] })
    const adapter = new DaemonBookmarkAdapter({ client })
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
    const adapter = new DaemonBookmarkAdapter({ client })
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
    const adapter = new DaemonBookmarkAdapter({ client })
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
    const adapter = new DaemonBookmarkAdapter({ client })

    await expect(adapter.checkHealth?.()).resolves.toEqual({
      ready: false,
      warnings,
    })
  })

  it("dispose() closes the underlying event connection", async () => {
    const sse = await import("../sse")
    const disconnect = vi.fn()
    vi.mocked(sse.connectDaemonEvents).mockReturnValue(disconnect)

    const adapter = new DaemonBookmarkAdapter({ client })
    adapter.dispose()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})

/**
 * A folder whose children exercise every rule the order contract cares about:
 * an ordinary bookmark, a read-only one, a nested folder, and a directory with
 * no `.bbb-folder.md` (a synthetic `!path` id the order file cannot name).
 */
const orderedFolder: BookmarkNode = {
  id: "folder-o",
  title: "Ordered",
  revision: "rev-o",
  stateRevision: "state-1",
  children: [
    {
      id: "child-1",
      title: "First",
      url: "https://one.test",
      parentId: "folder-o",
      revision: "rev-c1",
    },
    {
      id: "child-2",
      title: "Second",
      parentId: "folder-o",
      revision: "rev-c2",
      children: [],
    },
    {
      id: "child-3",
      title: "Third (read-only)",
      url: "https://three.test",
      parentId: "folder-o",
      readOnly: true,
    },
    {
      id: "!loose/dir",
      title: "loose",
      parentId: "folder-o",
      readOnly: true,
      children: [],
    },
  ],
}

/** Same folder, minus the order file — the state a first PUT must describe. */
const unorderedFolder: BookmarkNode = {
  ...orderedFolder,
  stateRevision: undefined,
  children: orderedFolder.children?.slice(0, 2),
}

async function adapterFor(folder: BookmarkNode) {
  vi.mocked(client.fetchTree).mockResolvedValue({ tree: [folder] })
  const adapter = new DaemonBookmarkAdapter({ client })
  await adapter.getTree()
  vi.mocked(client.fetchNode).mockResolvedValue(folder)
  vi.mocked(client.setOrder).mockResolvedValue(folder)
  return adapter
}

describe("DaemonBookmarkAdapter.setChildOrder", () => {
  it("PUTs the requested permutation, carrying each child's server-side kind", async () => {
    const adapter = await adapterFor(orderedFolder)

    await adapter.setChildOrder?.("folder-o", ["child-2", "child-1", "child-3"])

    expect(client.setOrder).toHaveBeenCalledWith("folder-o", {
      stateRevision: "state-1",
      children: [
        { id: "child-2", kind: "folder" },
        { id: "child-1", kind: "bookmark" },
        { id: "child-3", kind: "bookmark" },
      ],
    })
  })

  it("re-reads the folder before writing, rather than trusting the caller's snapshot", async () => {
    const adapter = await adapterFor(orderedFolder)

    await adapter.setChildOrder?.("folder-o", ["child-2", "child-1", "child-3"])

    // The GET is what makes the payload a valid permutation instead of a guess.
    expect(client.fetchNode).toHaveBeenCalledWith("folder-o")
    expect(
      vi.mocked(client.fetchNode).mock.invocationCallOrder[0]
    ).toBeLessThan(vi.mocked(client.setOrder).mock.invocationCallOrder[0])
  })

  it("omits the stateRevision key entirely for a folder that has no order file", async () => {
    const adapter = await adapterFor(unorderedFolder)

    await adapter.setChildOrder?.("folder-o", ["child-2", "child-1"])

    const [, body] = vi.mocked(client.setOrder).mock.calls[0]
    // Absence is a claim the daemon verifies — an invented or empty revision
    // is a 409, and a serialized `null` is a 400.
    expect("stateRevision" in body).toBe(false)
    expect(JSON.parse(JSON.stringify(body))).toEqual({
      children: [
        { id: "child-2", kind: "folder" },
        { id: "child-1", kind: "bookmark" },
      ],
    })
  })

  it("refreshes the cached stateRevision from the response, so a second write sends the new one", async () => {
    const adapter = await adapterFor(unorderedFolder)

    // First write: no order file yet, so nothing is sent.
    vi.mocked(client.setOrder).mockResolvedValue({
      ...unorderedFolder,
      stateRevision: "state-fresh",
    })
    await adapter.setChildOrder?.("folder-o", ["child-2", "child-1"])
    expect("stateRevision" in vi.mocked(client.setOrder).mock.calls[0][1]).toBe(
      false
    )

    // Second write: the daemon has written the first file, and the re-read is
    // what picks it up — the cache alone would still be claiming "none".
    vi.mocked(client.fetchNode).mockResolvedValue({
      ...unorderedFolder,
      stateRevision: "state-fresh",
    })
    await adapter.setChildOrder?.("folder-o", ["child-2", "child-1"])
    expect(vi.mocked(client.setOrder).mock.calls[1][1].stateRevision).toBe(
      "state-fresh"
    )
  })

  it("excludes a `!path` directory from the payload without letting it block its siblings", async () => {
    const adapter = await adapterFor(orderedFolder)

    // The caller names it — the UI lists it as a row — and it must still not
    // reach the wire: `Id::parse` rejects it as a 400.
    await adapter.setChildOrder?.("folder-o", [
      "child-3",
      "!loose/dir",
      "child-1",
      "child-2",
    ])

    const [, body] = vi.mocked(client.setOrder).mock.calls[0]
    expect(body.children.map((c) => c.id)).toEqual([
      "child-3",
      "child-1",
      "child-2",
    ])
  })

  it("includes read-only children, which are ordered like any other", async () => {
    const adapter = await adapterFor(orderedFolder)

    await adapter.setChildOrder?.("folder-o", ["child-2", "child-1"])

    // `child-3` is read-only but addressable; omitting it is a 422, so the
    // drag-gating rule must never be reused as a payload filter.
    const [, body] = vi.mocked(client.setOrder).mock.calls[0]
    expect(body.children.map((c) => c.id)).toEqual([
      "child-2",
      "child-1",
      "child-3",
    ])
  })

  it("appends children the caller never mentioned, keeping their server order", async () => {
    const adapter = await adapterFor(orderedFolder)

    await adapter.setChildOrder?.("folder-o", ["child-3"])

    const [, body] = vi.mocked(client.setOrder).mock.calls[0]
    expect(body.children.map((c) => c.id)).toEqual([
      "child-3",
      "child-1",
      "child-2",
    ])
  })

  it("drops ids the folder no longer holds", async () => {
    const adapter = await adapterFor(orderedFolder)

    await adapter.setChildOrder?.("folder-o", [
      "child-2",
      "deleted-elsewhere",
      "child-1",
      "child-3",
    ])

    const [, body] = vi.mocked(client.setOrder).mock.calls[0]
    expect(body.children.map((c) => c.id)).toEqual([
      "child-2",
      "child-1",
      "child-3",
    ])
  })

  it("dedupes a repeated id, keeping its first occurrence", async () => {
    const duplicated: BookmarkNode = {
      ...orderedFolder,
      children: [
        ...(orderedFolder.children ?? []),
        {
          id: "child-1",
          title: "First (duplicate identity)",
          url: "https://one-again.test",
          parentId: "folder-o",
        },
      ],
    }
    const adapter = await adapterFor(duplicated)

    await adapter.setChildOrder?.("folder-o", [
      "child-2",
      "child-1",
      "child-2",
      "child-3",
    ])

    // A child order must name every child exactly once, and the daemon's own
    // `addressable_children` dedupes the same way.
    const [, body] = vi.mocked(client.setOrder).mock.calls[0]
    expect(body.children.map((c) => c.id)).toEqual([
      "child-2",
      "child-1",
      "child-3",
    ])
  })

  it("sends nothing when the folder is already in the requested order", async () => {
    const adapter = await adapterFor(orderedFolder)

    await adapter.setChildOrder?.("folder-o", ["child-1", "child-2", "child-3"])

    // The daemon would write zero bytes anyway; skipping also avoids a
    // pointless notify/refresh cycle.
    expect(client.setOrder).not.toHaveBeenCalled()
  })

  it("treats a caller list that only reshuffles the unaddressable directory as a no-op", async () => {
    const adapter = await adapterFor(orderedFolder)

    await adapter.setChildOrder?.("folder-o", [
      "!loose/dir",
      "child-1",
      "child-2",
      "child-3",
    ])

    expect(client.setOrder).not.toHaveBeenCalled()
  })

  it("notifies onChanged listeners after a successful write, but not after a no-op", async () => {
    const adapter = await adapterFor(orderedFolder)
    const onChanged = vi.fn()
    adapter.onChanged(onChanged)

    await adapter.setChildOrder?.("folder-o", ["child-1", "child-2", "child-3"])
    expect(onChanged).not.toHaveBeenCalled()

    await adapter.setChildOrder?.("folder-o", ["child-3", "child-1", "child-2"])
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it("does not pre-empt an orderReadOnly folder — the daemon stays the authority", async () => {
    const frozen: BookmarkNode = { ...orderedFolder, orderReadOnly: true }
    const adapter = await adapterFor(frozen)

    await adapter.setChildOrder?.("folder-o", ["child-3", "child-1", "child-2"])

    // The flag disables the affordance in the UI; it must not simulate the
    // refusal here, or a stale flag would block a write the daemon allows.
    expect(client.setOrder).toHaveBeenCalledTimes(1)
  })

  it("surfaces the daemon's refusal rather than swallowing it", async () => {
    const adapter = await adapterFor(orderedFolder)
    vi.mocked(client.setOrder).mockRejectedValue(
      Object.assign(new Error("frozen"), { code: "state_read_only" })
    )

    await expect(
      adapter.setChildOrder?.("folder-o", ["child-3", "child-1", "child-2"])
    ).rejects.toMatchObject({ code: "state_read_only" })
  })

  it("never writes an order it could not first read the folder for", async () => {
    const adapter = await adapterFor(orderedFolder)
    vi.mocked(client.fetchNode).mockRejectedValue(
      Object.assign(new Error("no such folder"), { code: "not_found" })
    )

    await expect(
      adapter.setChildOrder?.("folder-o", ["child-3", "child-1", "child-2"])
    ).rejects.toMatchObject({ code: "not_found" })
    expect(client.setOrder).not.toHaveBeenCalled()
  })
})
