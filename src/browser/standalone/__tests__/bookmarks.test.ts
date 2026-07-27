// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { StandaloneBookmarkAdapter } from "../bookmarks"

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

    expect(tree).toEqual([])
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
})
