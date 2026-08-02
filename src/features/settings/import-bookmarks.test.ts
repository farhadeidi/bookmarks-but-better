import { describe, expect, it, vi } from "vitest"
import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import { executeImportPlan, formatImportResult } from "./import-bookmarks"
import type { ImportPlanNode } from "./import-plan"
import type { ImportResult } from "./import-bookmarks"

function makeAdapter(overrides: Partial<BookmarkAdapter>): BookmarkAdapter {
  return overrides as unknown as BookmarkAdapter
}

/** Accepts everything, handing back a unique id per call. */
function acceptingAdapter() {
  let n = 0
  const create = vi.fn(
    async (input: { parentId: string; title: string; url?: string }) =>
      ({
        id: `created-${++n}`,
        title: input.title,
        url: input.url,
        parentId: input.parentId,
      }) as BookmarkNode
  )
  const update = vi.fn(async (id: string, changes: { title?: string }) => ({
    id,
    title: changes.title ?? "",
  }))
  return { adapter: makeAdapter({ create, update }), create, update }
}

const PLAN: ImportPlanNode[] = [
  { kind: "bookmark", title: "A", url: "https://a.com", conflict: null },
  {
    kind: "folder",
    title: "Folder",
    existingId: null,
    children: [
      { kind: "bookmark", title: "B", url: "https://b.com", conflict: null },
      { kind: "folder", title: "Nested", existingId: null, children: [] },
    ],
  },
]

const EMPTY: ImportResult = {
  folders: 0,
  merged: 0,
  bookmarks: 0,
  replaced: 0,
  skipped: 0,
  failed: 0,
  firstError: null,
}

describe("executeImportPlan", () => {
  it("writes the whole plan under the target parent", async () => {
    const { adapter, create } = acceptingAdapter()

    const result = await executeImportPlan(adapter, PLAN, "target")

    expect(result).toEqual({ ...EMPTY, folders: 2, bookmarks: 2 })
    expect(create).toHaveBeenCalledWith({
      parentId: "target",
      title: "A",
      url: "https://a.com",
    })
  })

  it("writes into an existing folder instead of creating it again", async () => {
    const { adapter, create } = acceptingAdapter()
    const plan: ImportPlanNode[] = [
      {
        kind: "folder",
        title: "Dev Tools",
        existingId: "existing-folder",
        children: [
          {
            kind: "bookmark",
            title: "B",
            url: "https://b.com",
            conflict: null,
          },
        ],
      },
    ]

    const result = await executeImportPlan(adapter, plan, "target")

    expect(result).toMatchObject({ folders: 0, merged: 1, bookmarks: 1 })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith({
      parentId: "existing-folder",
      title: "B",
      url: "https://b.com",
    })
  })

  it("skips a conflicting bookmark without touching the adapter", async () => {
    const { adapter, create, update } = acceptingAdapter()
    const plan: ImportPlanNode[] = [
      {
        kind: "bookmark",
        title: "New title",
        url: "https://a.com",
        conflict: { key: "c0", existingId: "old" },
      },
    ]

    const result = await executeImportPlan(adapter, plan, "target", {
      c0: "skip",
    })

    expect(result).toMatchObject({ skipped: 1, bookmarks: 0, replaced: 0 })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it("retitles the existing bookmark in place for replace", async () => {
    const { adapter, create, update } = acceptingAdapter()
    const plan: ImportPlanNode[] = [
      {
        kind: "bookmark",
        title: "New title",
        url: "https://a.com",
        conflict: { key: "c0", existingId: "old" },
      },
    ]

    const result = await executeImportPlan(adapter, plan, "target", {
      c0: "replace",
    })

    expect(result).toMatchObject({ replaced: 1, bookmarks: 0 })
    expect(update).toHaveBeenCalledWith("old", { title: "New title" })
    expect(create).not.toHaveBeenCalled()
  })

  it("creates a second copy for keep-both", async () => {
    const { adapter, create } = acceptingAdapter()
    const plan: ImportPlanNode[] = [
      {
        kind: "bookmark",
        title: "New title",
        url: "https://a.com",
        conflict: { key: "c0", existingId: "old" },
      },
    ]

    const result = await executeImportPlan(adapter, plan, "target", {
      c0: "keep-both",
    })

    expect(result).toMatchObject({ bookmarks: 1, skipped: 0, replaced: 0 })
    expect(create).toHaveBeenCalledWith({
      parentId: "target",
      title: "New title",
      url: "https://a.com",
    })
  })

  it("defaults an unanswered conflict to skip, so nothing existing is disturbed", async () => {
    const { adapter, create, update } = acceptingAdapter()
    const plan: ImportPlanNode[] = [
      {
        kind: "bookmark",
        title: "New title",
        url: "https://a.com",
        conflict: { key: "c0", existingId: "old" },
      },
    ]

    const result = await executeImportPlan(adapter, plan, "target")

    expect(result).toMatchObject({ skipped: 1 })
    expect(create).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it("keeps going when a single bookmark is rejected", async () => {
    let n = 0
    const adapter = makeAdapter({
      create: async (input) => {
        if (input.url === "https://b.com") {
          throw new Error("a url cannot be empty")
        }
        return {
          id: `created-${++n}`,
          title: input.title,
          url: input.url,
        } as BookmarkNode
      },
    })

    const result = await executeImportPlan(adapter, PLAN, "target")

    expect(result).toMatchObject({
      bookmarks: 1,
      folders: 2,
      failed: 1,
      firstError: "a url cannot be empty",
    })
  })

  it("counts a rejected folder's whole subtree as lost, and skips writing it", async () => {
    const create = vi.fn(async (input: { title: string }) => {
      if (input.title === "Folder") throw new Error("nope")
      return { id: "created", title: input.title } as BookmarkNode
    })

    const result = await executeImportPlan(
      makeAdapter({ create: create as never }),
      PLAN,
      "target"
    )

    expect(result).toMatchObject({ bookmarks: 1, folders: 0 })
    // "Folder" itself, its bookmark "B", and its "Nested" child.
    expect(result.failed).toBe(3)
    expect(create.mock.calls.some(([input]) => input.title === "Nested")).toBe(
      false
    )
  })

  it("never exceeds the concurrency limit, across folders as well as within one", async () => {
    let inFlight = 0
    let peak = 0
    let n = 0
    const adapter = makeAdapter({
      create: async (input) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        inFlight -= 1
        return { id: `created-${++n}`, title: input.title } as BookmarkNode
      },
    })

    // 10 sibling folders of 5 bookmarks each. Batching per level would create
    // all 10 folders at once and then run 10 subtrees in parallel, each with
    // its own allowance.
    const plan: ImportPlanNode[] = Array.from({ length: 10 }, (_, f) => ({
      kind: "folder" as const,
      title: `f${f}`,
      existingId: null,
      children: Array.from({ length: 5 }, (_, b) => ({
        kind: "bookmark" as const,
        title: `b${f}-${b}`,
        url: `https://example.com/${f}/${b}`,
        conflict: null,
      })),
    }))

    const result = await executeImportPlan(adapter, plan, "target", {}, 3)

    expect(result).toMatchObject({ folders: 10, bookmarks: 50, failed: 0 })
    expect(peak).toBeLessThanOrEqual(3)
  })

  it("never rejects, so a caller cannot end up with an unhandled error", async () => {
    const adapter = makeAdapter({
      create: async () => {
        throw new Error("everything is broken")
      },
    })

    await expect(
      executeImportPlan(adapter, PLAN, "target")
    ).resolves.toMatchObject({ folders: 0, bookmarks: 0, failed: 4 })
  })
})

describe("formatImportResult", () => {
  it("summarizes a clean import", () => {
    expect(formatImportResult({ ...EMPTY, folders: 2, bookmarks: 1 })).toBe(
      "Imported 1 bookmark and 2 folders."
    )
  })

  it("reports merges and conflict outcomes", () => {
    expect(
      formatImportResult({
        ...EMPTY,
        folders: 1,
        merged: 3,
        bookmarks: 10,
        replaced: 2,
        skipped: 4,
      })
    ).toBe(
      "Imported 10 bookmarks and 1 folder. 3 folders merged, 2 duplicates replaced, 4 duplicates skipped."
    )
  })

  it("reports failures with the underlying reason", () => {
    expect(
      formatImportResult({
        ...EMPTY,
        bookmarks: 5,
        failed: 2,
        firstError: "a title cannot be empty",
      })
    ).toBe(
      "Imported 5 bookmarks and 0 folders. 2 items could not be imported (a title cannot be empty)."
    )
  })
})
