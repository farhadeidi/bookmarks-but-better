// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import type { BookmarkNode } from "@/browser"
import { materializeSeed, MutableBookmarkEngine } from "./engine"
import { clearSourceData, devGet, SOURCES_STORE } from "./state"

installFakeIndexedDB()

function browserRoot(): BookmarkNode {
  return materializeSeed(
    "0",
    "",
    "b",
    [],
    [
      { id: "1", title: "Bookmarks Bar", children: [] },
      { id: "2", title: "Other bookmarks", children: [] },
    ]
  )
}

function vaultRoot(): BookmarkNode {
  return materializeSeed("root", "reading", "d", [
    { title: "Articles", children: [{ title: "A", url: "https://a.example" }] },
  ])
}

function collectTitles(node: BookmarkNode): string[] {
  const titles: string[] = []
  const visit = (n: BookmarkNode) => {
    titles.push(n.title)
    for (const child of n.children ?? []) visit(child)
  }
  visit(node)
  return titles
}

beforeEach(async () => {
  await clearSourceData()
})

describe("seeding and persistence", () => {
  it("seeds deterministically when nothing is persisted, and stays seeded", async () => {
    const a = new MutableBookmarkEngine({
      sourceKey: "browser",
      flavor: "browser",
      seed: browserRoot,
    })
    const first = await a.getTree()
    const b = new MutableBookmarkEngine({
      sourceKey: "browser",
      flavor: "browser",
      seed: browserRoot,
    })
    const second = await b.getTree()

    expect(second).toEqual(first)
    expect(first[0]!.children!.map((c) => c.title)).toEqual([
      "Bookmarks Bar",
      "Other bookmarks",
    ])
  })

  it("persists mutations and hydrates them in a fresh engine", async () => {
    const a = new MutableBookmarkEngine({
      sourceKey: "browser",
      flavor: "browser",
      seed: browserRoot,
    })
    const folder = await a.create({ parentId: "1", title: "Docs" })
    await a.create({
      parentId: folder.id,
      title: "MDN",
      url: "https://developer.mozilla.org",
    })

    const b = new MutableBookmarkEngine({
      sourceKey: "browser",
      flavor: "browser",
      seed: browserRoot,
    })
    const tree = await b.getTree()
    expect(collectTitles(tree[0])).toContain("MDN")
    // The persisted tree, not the seed.
    expect(await devGet(SOURCES_STORE, "tree:browser")).not.toBeNull()
  })

  it("clearing the store restores the exact seed", async () => {
    const a = new MutableBookmarkEngine({
      sourceKey: "browser",
      flavor: "browser",
      seed: browserRoot,
    })
    await a.create({ parentId: "1", title: "Temp" })
    await clearSourceData()

    const b = new MutableBookmarkEngine({
      sourceKey: "browser",
      flavor: "browser",
      seed: browserRoot,
    })
    const seeded = await b.getTree()
    expect(collectTitles(seeded[0])).not.toContain("Temp")
    expect(seeded).toEqual(
      await new MutableBookmarkEngine({
        sourceKey: "browser",
        flavor: "browser",
        seed: browserRoot,
      }).getTree()
    )
  })
})

describe("the application operations", () => {
  function engine(flavor: "browser" | "daemon" = "browser") {
    return new MutableBookmarkEngine({
      sourceKey: `op-${flavor}`,
      flavor,
      seed: flavor === "browser" ? browserRoot : vaultRoot,
    })
  }

  it("creates, updates and removes bookmarks", async () => {
    const e = engine()
    const created = await e.create({
      parentId: "1",
      title: "News",
      url: "https://news.example",
    })
    await e.update(created.id, { title: "Old News" })
    let tree = await e.getTree()
    expect(collectTitles(tree[0])).toContain("Old News")

    await e.remove(created.id)
    tree = await e.getTree()
    expect(collectTitles(tree[0])).not.toContain("Old News")
  })

  it("refuses to remove a non-empty folder, and removeTree clears it", async () => {
    const e = engine()
    const folder = await e.create({ parentId: "1", title: "Full" })
    await e.create({
      parentId: folder.id,
      title: "Child",
      url: "https://child.example",
    })

    await expect(e.remove(folder.id)).rejects.toThrow(/non-empty/)
    await expect(e.removeTree(folder.id)).resolves.toBeUndefined()
    const tree = await e.getTree()
    expect(collectTitles(tree[0])).not.toContain("Full")
  })

  it("moves honor the index for browser-flavored sources", async () => {
    const e = engine()
    const a = await e.create({ parentId: "1", title: "A" })
    await e.create({ parentId: "1", title: "B" })
    await e.create({ parentId: "1", title: "C" })
    await e.move(a.id, { parentId: "1", index: 2 })

    const tree = await e.getTree()
    const bar = tree[0]!.children!.find((c) => c.id === "1")!
    expect(bar.children!.map((c) => c.title)).toEqual(["B", "C", "A"])
  })

  it("daemon-flavored moves append at the end, ignoring the index", async () => {
    const e = engine("daemon")
    const first = (await e.getTree())[0]!.children![0]!
    const moved = await e.create({
      parentId: "root",
      title: "Movable",
      url: "https://m.example",
    })
    await e.move(moved.id, { parentId: "root", index: 0 })

    const tree = await e.getTree()
    const titles = tree[0]!.children!.map((c) => c.title)
    expect(titles[titles.length - 1]).toBe("Movable")
    expect(titles[0]).toBe(first.title)
  })

  it("setChildOrder reorders, drops unknown ids, and appends unmentioned children", async () => {
    const e = engine("daemon")
    const a = await e.create({ parentId: "root", title: "A" })
    const b = await e.create({ parentId: "root", title: "B" })
    const c = await e.create({ parentId: "root", title: "C" })
    void a
    // The seed's Articles folder is also a child of root.
    await e.setChildOrder("root", [c.id, b.id, "not-a-real-id"])

    const tree = await e.getTree()
    const titles = tree[0]!.children!.map((n) => n.title)
    expect(titles.slice(0, 2)).toEqual(["C", "B"])
    // A and the seeded folder keep their relative order at the end.
    expect(titles.slice(2)).toContain("A")
    expect(titles).not.toContain("not-a-real-id")
  })

  it("refuses to move a folder into its own subtree", async () => {
    const e = engine()
    const folder = await e.create({ parentId: "1", title: "Outer" })
    await e.create({ parentId: folder.id, title: "Inner" })
    await expect(
      e.move(folder.id, { parentId: folder.id, index: 0 })
    ).rejects.toThrow(/into itself/)
  })

  it("emits the change events adapters subscribe to", async () => {
    const e = engine()
    const events: string[] = []
    e.subscribe("created", () => events.push("created"))
    e.subscribe("changed", () => events.push("changed"))
    e.subscribe("removed", () => events.push("removed"))
    e.subscribe("moved", () => events.push("moved"))

    const node = await e.create({ parentId: "1", title: "N" })
    await e.update(node.id, { title: "N2" })
    await e.move(node.id, { parentId: "1", index: 0 })
    await e.remove(node.id)

    expect(events).toEqual(["created", "changed", "moved", "removed"])
  })

  it("dispose drops listeners but keeps data", async () => {
    const e = engine()
    let fired = 0
    e.subscribe("created", () => fired++)
    e.dispose()
    await e.create({ parentId: "1", title: "After" })
    expect(fired).toBe(0)
    expect(collectTitles((await e.getTree())[0])).toContain("After")
  })
})
