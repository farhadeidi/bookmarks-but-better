import { afterEach, describe, expect, it, vi } from "vitest"
import type { BookmarkNode } from "../../types"
import type { DaemonHealth, DaemonTreeResponse } from "../client"
import { DaemonBookmarkAdapter } from "../bookmarks"

/**
 * Fixtures are typed against the exact response interfaces the client
 * exports. If the wire shape regresses (e.g. `{ root }` instead of
 * `{ tree }`, or a wrapped `{ node }` instead of a bare DTO), these literals
 * fail to typecheck — this file can't silently keep passing against an old
 * shape the way a same-file mock object could.
 */
const TREE_FIXTURE: DaemonTreeResponse = {
  tree: [
    {
      id: "root",
      title: "Vault",
      revision: "rev-root",
      children: [
        {
          id: "bookmark-1",
          title: "Example",
          url: "https://example.com",
          parentId: "root",
          revision: "rev-1",
          readOnly: true,
          diagnostics: [
            {
              code: "invalid_id",
              severity: "error",
              detail: "bbb_id is missing.",
              path: "notes/Example--a1b2c3d4.md",
              line: 2,
            },
          ],
        },
      ],
    },
  ],
}

const HEALTH_FIXTURE: DaemonHealth = {
  status: "ok",
  version: "0.1.0",
  generation: 3,
  warnings: [],
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("daemon wire contract", () => {
  it("GET /api/v1/tree returns {tree:[...]} and getTree() returns it with no extra wrapping", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(TREE_FIXTURE))
    vi.stubGlobal("fetch", fetchMock)

    const adapter = new DaemonBookmarkAdapter()
    const tree = await adapter.getTree()

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/tree")
    expect(tree).toEqual(TREE_FIXTURE.tree)
    expect(tree[0].children?.[0].diagnostics?.[0].detail).toBe(
      "bbb_id is missing."
    )
  })

  it("getSubTree() hits GET /api/v1/bookmarks/:id and receives a bare DTO, not a wrapper object", async () => {
    const bareDto: BookmarkNode = {
      id: "folder-a",
      title: "Folder A",
      revision: "rev-a",
      children: [],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(bareDto))
    vi.stubGlobal("fetch", fetchMock)

    const adapter = new DaemonBookmarkAdapter()
    const [node] = await adapter.getSubTree("folder-a")

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/bookmarks/folder-a")
    expect(node).toEqual(bareDto)
  })

  it("PATCH and move always target /api/v1/bookmarks/:id, even for a folder", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse(TREE_FIXTURE))

    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree() // root is a folder (no url)

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...TREE_FIXTURE.tree[0],
        title: "Renamed Vault",
        revision: "rev-root-2",
      })
    )
    await adapter.update("root", { title: "Renamed Vault" })
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/bookmarks/root")
    expect(fetchMock.mock.calls[1][1].method).toBe("PATCH")
  })

  it("move() reads the daemon's real 200 DTO response and refreshes the cached revision from it", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse(TREE_FIXTURE))

    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree() // root is a folder, cached with revision "rev-root"

    // The daemon's move handler returns the moved entry's own BookmarkDto
    // (200, not 204) — this is what actually carries the post-move revision.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...TREE_FIXTURE.tree[0],
        parentId: "other-parent",
        revision: "rev-root-moved",
      })
    )
    await adapter.move("root", { parentId: "other-parent", index: 0 })
    expect(fetchMock.mock.calls[1][0]).toBe("/api/v1/bookmarks/root/move")
    expect(fetchMock.mock.calls[1][1].method).toBe("POST")
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      revision: "rev-root",
      parentId: "other-parent",
    })

    // Proof the cache actually refreshed from the move response: a follow-up
    // mutation must send the *new* revision, not the pre-move one.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        ...TREE_FIXTURE.tree[0],
        title: "Renamed after move",
        revision: "rev-root-moved-2",
      })
    )
    await adapter.update("root", { title: "Renamed after move" })
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
      revision: "rev-root-moved",
      title: "Renamed after move",
    })
  })

  it("delete keeps kind routing: a folder delete targets /api/v1/folders/:id, and removeTree sends recursive=true", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    fetchMock.mockResolvedValueOnce(jsonResponse(TREE_FIXTURE))

    const adapter = new DaemonBookmarkAdapter()
    await adapter.getTree() // root is a folder

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await adapter.removeTree("root")

    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toContain("/api/v1/folders/root")
    expect(url).toContain("recursive=true")
    expect(init.method).toBe("DELETE")
  })

  it("ProblemDetails carries a stable code that DaemonApiError exposes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            title: "Stale revision",
            detail: "Revision mismatch: the file changed on disk.",
            code: "stale_revision",
            status: 409,
          },
          409
        )
      )
    )

    const { fetchHealth } = await import("../client")
    await expect(fetchHealth()).rejects.toMatchObject({
      name: "DaemonApiError",
      code: "stale_revision",
      status: 409,
      message: "Revision mismatch: the file changed on disk.",
    })
  })

  it("health reports version/generation/warnings, and the adapter derives readiness from status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() => jsonResponse(HEALTH_FIXTURE))
    )

    const { fetchHealth } = await import("../client")
    await expect(fetchHealth()).resolves.toEqual(HEALTH_FIXTURE)

    const adapter = new DaemonBookmarkAdapter()
    await expect(adapter.checkHealth?.()).resolves.toEqual({
      ready: true,
      warnings: [],
    })
  })
})
