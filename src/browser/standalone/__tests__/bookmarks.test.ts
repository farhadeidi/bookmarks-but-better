// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { StandaloneBookmarkAdapter } from "../bookmarks"

vi.mock("@/dev/seed-bookmarks.json", () => {
  throw new Error("seed-bookmarks.json must never be imported outside of DEV")
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
