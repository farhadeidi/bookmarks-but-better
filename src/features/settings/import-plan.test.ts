import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import { normalizeUrl, planImport } from "./import-plan"

const TREE: BookmarkNode[] = [
  {
    id: "0",
    title: "",
    children: [
      {
        id: "dest",
        title: "Destination",
        children: [
          { id: "old-a", title: "Old A", url: "https://a.com" },
          {
            id: "old-dev",
            title: "Dev Tools",
            children: [{ id: "old-b", title: "Old B", url: "https://b.com/" }],
          },
        ],
      },
    ],
  },
]

function imported(nodes: BookmarkNode[]): BookmarkNode[] {
  return nodes
}

describe("normalizeUrl", () => {
  it("folds scheme and host case", () => {
    expect(normalizeUrl("HTTPS://Example.COM/Path")).toBe(
      normalizeUrl("https://example.com/Path")
    )
  })

  it("treats a bare host and a trailing slash as the same place", () => {
    expect(normalizeUrl("https://a.com")).toBe(normalizeUrl("https://a.com/"))
  })

  it("keeps the path case, which servers may care about", () => {
    expect(normalizeUrl("https://a.com/A")).not.toBe(
      normalizeUrl("https://a.com/a")
    )
  })

  it("keeps distinct fragments apart", () => {
    expect(normalizeUrl("https://a.com/#/inbox")).not.toBe(
      normalizeUrl("https://a.com/#/sent")
    )
  })

  it("falls back to the raw value for a schemeless or opaque URL", () => {
    expect(normalizeUrl(" JavaScript:void(0) ")).toBe("javascript:void(0)")
  })
})

describe("planImport", () => {
  it("reports no conflicts for entirely new content", () => {
    const plan = planImport(
      TREE,
      "dest",
      imported([{ id: "1", title: "New", url: "https://new.com" }])
    )

    expect(plan.conflicts).toEqual([])
    expect(plan.nodes).toEqual([
      {
        kind: "bookmark",
        title: "New",
        url: "https://new.com",
        conflict: null,
      },
    ])
  })

  it("flags a bookmark whose URL is already in the destination", () => {
    const plan = planImport(
      TREE,
      "dest",
      imported([{ id: "1", title: "New A", url: "https://a.com/" }])
    )

    expect(plan.conflicts).toEqual([
      {
        key: "c0",
        path: "",
        incomingTitle: "New A",
        existingTitle: "Old A",
        url: "https://a.com/",
      },
    ])
    expect(plan.nodes[0]).toMatchObject({
      conflict: { key: "c0", existingId: "old-a" },
    })
  })

  it("merges a folder of the same name instead of creating a second one", () => {
    const plan = planImport(
      TREE,
      "dest",
      imported([
        {
          id: "1",
          title: "dev tools",
          children: [{ id: "2", title: "C", url: "https://c.com" }],
        },
      ])
    )

    expect(plan.nodes[0]).toMatchObject({
      kind: "folder",
      title: "dev tools",
      existingId: "old-dev",
    })
    expect(plan.conflicts).toEqual([])
  })

  it("compares one level deeper inside a merged folder", () => {
    const plan = planImport(
      TREE,
      "dest",
      imported([
        {
          id: "1",
          title: "Dev Tools",
          children: [{ id: "2", title: "New B", url: "https://b.com" }],
        },
      ])
    )

    expect(plan.conflicts).toEqual([
      {
        key: "c0",
        path: "Dev Tools",
        incomingTitle: "New B",
        existingTitle: "Old B",
        url: "https://b.com",
      },
    ])
  })

  it("does not flag a bookmark that only collides in a different folder", () => {
    const plan = planImport(
      TREE,
      "dest",
      imported([
        {
          id: "1",
          title: "Elsewhere",
          children: [{ id: "2", title: "A again", url: "https://a.com" }],
        },
      ])
    )

    expect(plan.conflicts).toEqual([])
  })

  it("does not treat duplicates inside the imported file as conflicts", () => {
    const plan = planImport(
      TREE,
      "dest",
      imported([
        { id: "1", title: "New", url: "https://new.com" },
        { id: "2", title: "New again", url: "https://new.com" },
      ])
    )

    expect(plan.conflicts).toEqual([])
    expect(plan.nodes).toHaveLength(2)
  })

  it("plans everything as new when the destination is not in the tree", () => {
    const plan = planImport(
      TREE,
      "missing",
      imported([{ id: "1", title: "Old A", url: "https://a.com" }])
    )

    expect(plan.conflicts).toEqual([])
  })
})
