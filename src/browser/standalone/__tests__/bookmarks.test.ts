// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { StandaloneBookmarkAdapter, STANDALONE_ROOT_ID } from "../bookmarks"

// Throws if the dev seed is ever imported outside of DEV; returns the real
// seed data when DEV is on, so the same mock also backs the write-path test
// below without letting either test recreate the production bug it guards.
vi.mock("@/dev/seed-bookmarks.json", async () => {
  if (!import.meta.env.DEV) {
    throw new Error("seed-bookmarks.json must never be imported outside of DEV")
  }
  return vi.importActual("@/dev/seed-bookmarks.json")
})

installFakeIndexedDB()

let originalDev: boolean

beforeEach(() => {
  originalDev = import.meta.env.DEV
  installFakeIndexedDB()
})

afterEach(() => {
  import.meta.env.DEV = originalDev
  vi.unstubAllGlobals()
})

describe("StandaloneBookmarkAdapter.getTree in production", () => {
  it("returns an empty tree instead of auto-importing the dev seed data", async () => {
    import.meta.env.DEV = false

    const adapter = new StandaloneBookmarkAdapter()
    const tree = await adapter.getTree()

    expect(tree).toEqual([{ id: STANDALONE_ROOT_ID, title: "", children: [] }])
  })
})

describe("StandaloneBookmarkAdapter synthetic root", () => {
  it("creates at the synthetic root as a top-level row, not underneath one", async () => {
    import.meta.env.DEV = false
    const adapter = new StandaloneBookmarkAdapter()

    const created = await adapter.create({
      parentId: STANDALONE_ROOT_ID,
      title: "Top level",
    })

    // The synthetic root is never persisted, so the row must come back with
    // no parent at all — otherwise it would nest under a phantom id.
    expect(created.parentId).toBeUndefined()

    const [root] = await adapter.getTree()
    expect(root.id).toBe(STANDALONE_ROOT_ID)
    expect(root.children?.map((c) => c.title)).toEqual(["Top level"])
  })

  it("keeps `tree[0]` a folder even when the first stored row is a bookmark", async () => {
    import.meta.env.DEV = false
    const adapter = new StandaloneBookmarkAdapter()

    await adapter.create({
      parentId: STANDALONE_ROOT_ID,
      title: "A bookmark",
      url: "https://example.com",
    })

    const [root] = await adapter.getTree()
    expect(root.url).toBeUndefined()
    expect(root.children).toHaveLength(1)
  })

  it("moves a nested row back out to the top level through the synthetic root", async () => {
    import.meta.env.DEV = false
    const adapter = new StandaloneBookmarkAdapter()

    const folder = await adapter.create({
      parentId: STANDALONE_ROOT_ID,
      title: "Folder",
    })
    const child = await adapter.create({
      parentId: folder.id,
      title: "Child",
      url: "https://example.com",
    })

    await adapter.move(child.id, { parentId: STANDALONE_ROOT_ID, index: 0 })

    const [root] = await adapter.getTree()
    expect(root.children?.map((c) => c.title).sort()).toEqual([
      "Child",
      "Folder",
    ])
  })
})

describe("StandaloneBookmarkAdapter.getTree seeding in dev", () => {
  it("seeds the dev bookmark data and completes the write transaction (does not hang)", async () => {
    const adapter = new StandaloneBookmarkAdapter()

    const tree = await adapter.getTree()
    expect(tree.length).toBeGreaterThan(0)

    // A second call reads back the persisted data instead of reseeding.
    const secondTree = await adapter.getTree()
    expect(secondTree).toEqual(tree)
  })

  it("does not stack the seed's own invisible root under the synthetic one", async () => {
    const adapter = new StandaloneBookmarkAdapter()

    const [root] = await adapter.getTree()

    expect(root.id).toBe(STANDALONE_ROOT_ID)
    // The seed is a browser export whose first node is a titleless root. If it
    // were stored as a row, everything would sit one nameless folder deep.
    const children = root.children ?? []
    expect(children.length).toBeGreaterThan(0)
    expect(children.every((child) => child.title !== "")).toBe(true)
    expect(children.map((child) => child.title)).toContain("Bookmarks Bar")
  })
})
