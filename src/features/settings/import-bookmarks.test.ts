import { describe, expect, it, vi } from "vitest"
import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import { formatImportResult, importBookmarkNodes } from "./import-bookmarks"

function makeAdapter(
  create: (input: {
    parentId: string
    title: string
    url?: string
  }) => Promise<BookmarkNode>
): BookmarkAdapter {
  return { create } as unknown as BookmarkAdapter
}

/** Accepts everything, handing back a unique id per call. */
function acceptingAdapter() {
  let n = 0
  const create = vi.fn(
    async (input: { parentId: string; title: string; url?: string }) => ({
      id: `created-${++n}`,
      title: input.title,
      url: input.url,
      parentId: input.parentId,
    })
  )
  return { adapter: makeAdapter(create), create }
}

const TREE: BookmarkNode[] = [
  { id: "b1", title: "A", url: "https://a.com" },
  {
    id: "f1",
    title: "Folder",
    children: [
      { id: "b2", title: "B", url: "https://b.com" },
      { id: "f2", title: "Nested", children: [] },
    ],
  },
]

describe("importBookmarkNodes", () => {
  it("writes the whole tree under the target parent", async () => {
    const { adapter, create } = acceptingAdapter()

    const result = await importBookmarkNodes(adapter, TREE, "target")

    expect(result).toEqual({
      folders: 2,
      bookmarks: 2,
      failed: 0,
      firstError: null,
    })
    expect(create).toHaveBeenCalledWith({
      parentId: "target",
      title: "A",
      url: "https://a.com",
    })
  })

  it("keeps going when a single bookmark is rejected", async () => {
    let n = 0
    const adapter = makeAdapter(async (input) => {
      if (input.url === "https://b.com")
        throw new Error("a url cannot be empty")
      return { id: `created-${++n}`, title: input.title, url: input.url }
    })

    const result = await importBookmarkNodes(adapter, TREE, "target")

    expect(result.bookmarks).toBe(1)
    expect(result.folders).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.firstError).toBe("a url cannot be empty")
  })

  it("counts a rejected folder's whole subtree as lost, and skips writing it", async () => {
    const create = vi.fn(async (input: { title: string }) => {
      if (input.title === "Folder") throw new Error("nope")
      return { id: "created", title: input.title }
    })

    const result = await importBookmarkNodes(
      makeAdapter(create as never),
      TREE,
      "target"
    )

    expect(result.bookmarks).toBe(1)
    expect(result.folders).toBe(0)
    // "Folder" itself, its bookmark "B", and its "Nested" child.
    expect(result.failed).toBe(3)
    expect(create.mock.calls.some(([input]) => input.title === "Nested")).toBe(
      false
    )
  })

  it("never rejects, so a caller cannot end up with an unhandled error", async () => {
    const adapter = makeAdapter(async () => {
      throw new Error("everything is broken")
    })

    await expect(
      importBookmarkNodes(adapter, TREE, "target")
    ).resolves.toMatchObject({ folders: 0, bookmarks: 0, failed: 4 })
  })
})

describe("formatImportResult", () => {
  it("summarizes a clean import", () => {
    expect(
      formatImportResult({
        folders: 2,
        bookmarks: 1,
        failed: 0,
        firstError: null,
      })
    ).toBe("Imported 1 bookmark and 2 folders.")
  })

  it("reports failures with the underlying reason", () => {
    expect(
      formatImportResult({
        folders: 0,
        bookmarks: 5,
        failed: 2,
        firstError: "a title cannot be empty",
      })
    ).toBe(
      "Imported 5 bookmarks and 0 folders. 2 items could not be imported (a title cannot be empty)."
    )
  })
})
