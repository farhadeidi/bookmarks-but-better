// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import type { BookmarkAdapter, BookmarkNode } from "@/browser"
import {
  STANDALONE_DEPRECATION_MESSAGE,
  STANDALONE_REMOVAL_MAJOR_VERSION,
  countBookmarks,
  planStandaloneMigration,
  runStandaloneMigration,
} from "./standalone-migration"

installFakeIndexedDB()

function treeOf(nodes: BookmarkNode[]): BookmarkNode[] {
  return [{ id: "root", title: "Root", children: nodes }]
}

function destinationAdapter(backing: BookmarkNode[] = []): {
  adapter: BookmarkAdapter
  created: { parentId: string; title: string; url?: string }[]
} {
  const created: { parentId: string; title: string; url?: string }[] = []
  const adapter: BookmarkAdapter = {
    getTree: vi.fn(async () => treeOf(backing)),
    getSubTree: vi.fn(async () => []),
    create: vi.fn(async (request) => {
      created.push(request)
      return {
        id: `new-${created.length}`,
        title: request.title,
        ...(request.url ? { url: request.url } : {}),
      }
    }),
    update: vi.fn(async (id, changes) => ({ id, ...changes }) as BookmarkNode),
    remove: vi.fn(async () => {}),
    removeTree: vi.fn(async () => {}),
    move: vi.fn(async () => {}),
    onChanged: vi.fn(() => () => {}),
    onCreated: vi.fn(() => () => {}),
    onRemoved: vi.fn(() => () => {}),
    onMoved: vi.fn(() => () => {}),
    openInManager: vi.fn(async () => {}),
  }
  return { adapter, created }
}

describe("the Standalone sunset contract", () => {
  it("the deprecation message names the removal version and the safe path", () => {
    expect(STANDALONE_DEPRECATION_MESSAGE).toContain(
      `version ${STANDALONE_REMOVAL_MAJOR_VERSION}.0`
    )
    expect(STANDALONE_DEPRECATION_MESSAGE).toContain("kept")
  })
})

describe("planStandaloneMigration", () => {
  it("previews the copy without writing anything", () => {
    const standalone = treeOf([
      { id: "s1", title: "Rust", url: "https://rust-lang.org" },
      {
        id: "f1",
        title: "Reading",
        children: [
          { id: "s2", title: "MDN", url: "https://developer.mozilla.org" },
        ],
      },
    ])
    const destination = treeOf([
      { id: "d1", title: "Existing", url: "https://example.com" },
    ])

    const preview = planStandaloneMigration(standalone, destination, "root")

    expect(preview.bookmarks).toBe(2)
    expect(preview.folders).toBe(1)
    expect(preview.conflicts).toBe(0)
    expect(preview.destinationBookmarks).toBe(1)
  })

  it("flags a duplicate as a conflict the user must resolve", () => {
    const standalone = treeOf([
      { id: "s1", title: "Rust", url: "https://rust-lang.org" },
    ])
    const destination = treeOf([
      { id: "d1", title: "Rust!", url: "https://rust-lang.org" },
    ])

    const preview = planStandaloneMigration(standalone, destination, "root")

    expect(preview.conflicts).toBe(1)
    expect(preview.plan.conflicts[0]).toMatchObject({
      incomingTitle: "Rust",
      existingTitle: "Rust!",
      url: "https://rust-lang.org",
    })
  })
})

describe("runStandaloneMigration", () => {
  it("copies through the import pipeline and verifies by re-reading the destination", async () => {
    const standalone = treeOf([
      { id: "s1", title: "Rust", url: "https://rust-lang.org" },
      {
        id: "f1",
        title: "Reading",
        children: [
          { id: "s2", title: "MDN", url: "https://developer.mozilla.org" },
        ],
      },
    ])
    const destination = treeOf([])
    const preview = planStandaloneMigration(standalone, destination, "root")

    let backing: BookmarkNode[] = []
    const { adapter } = destinationAdapter()
    // The destination's re-read for verification must reflect the copy, so
    // getTree returns the accumulated backing the create calls build up.
    ;(adapter.getTree as ReturnType<typeof vi.fn>).mockImplementation(
      async () => treeOf(backing)
    )
    ;(adapter.create as ReturnType<typeof vi.fn>).mockImplementation(
      async (request: { parentId: string; title: string; url?: string }) => {
        const node: BookmarkNode = request.url
          ? {
              id: `new-${request.title}`,
              title: request.title,
              url: request.url,
            }
          : {
              id: `new-${request.title}`,
              title: request.title,
              children: [],
            }
        backing = [...backing, node]
        return node
      }
    )

    const outcome = await runStandaloneMigration(adapter, preview, "root")

    expect(outcome.result.bookmarks).toBe(2)
    expect(outcome.result.folders).toBe(1)
    expect(outcome.verified).toBe(true)
    expect(outcome.verifiedCount).toBe(2)
  })

  it("a skipped conflict is not counted against verification", async () => {
    const standalone = treeOf([
      { id: "s1", title: "Rust", url: "https://rust-lang.org" },
    ])
    const destination = treeOf([
      { id: "d1", title: "Rust", url: "https://rust-lang.org" },
    ])
    const preview = planStandaloneMigration(standalone, destination, "root")
    expect(preview.conflicts).toBe(1)

    const backing = destination[0].children!
    const { adapter } = destinationAdapter(backing)

    const outcome = await runStandaloneMigration(
      adapter,
      preview,
      "root",
      // "skip" is the default an unanswered conflict gets; make it explicit.
      { [preview.plan.conflicts[0].key]: "skip" }
    )

    expect(outcome.result.skipped).toBe(1)
    expect(outcome.result.bookmarks).toBe(0)
    expect(outcome.verified).toBe(true)
  })

  it("verification fails honestly when items could not be written", async () => {
    const standalone = treeOf([
      { id: "s1", title: "Rust", url: "https://rust-lang.org" },
    ])
    const destination = treeOf([])
    const preview = planStandaloneMigration(standalone, destination, "root")

    const { adapter } = destinationAdapter([])
    ;(adapter.create as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("write refused")
    )

    const outcome = await runStandaloneMigration(adapter, preview, "root")

    expect(outcome.result.failed).toBe(1)
    expect(outcome.verified).toBe(false)
  })

  it("the copy never deletes from the standalone collection", async () => {
    const standalone = treeOf([
      { id: "s1", title: "Rust", url: "https://rust-lang.org" },
    ])
    const destination = treeOf([])
    const preview = planStandaloneMigration(standalone, destination, "root")
    const { adapter } = destinationAdapter([])

    await runStandaloneMigration(adapter, preview, "root")

    // The migration ran against the destination adapter only; the
    // standalone tree it planned from is untouched by construction — nothing
    // in the pipeline receives it as a writable target.
    expect(countBookmarks(standalone)).toBe(1)
    expect(adapter.remove).not.toHaveBeenCalled()
    expect(adapter.removeTree).not.toHaveBeenCalled()
  })
})
