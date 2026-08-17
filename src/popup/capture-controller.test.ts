import { describe, expect, it, vi } from "vitest"
import type { BookmarkNode, BrowserAdapter } from "@/browser/types"
import {
  CaptureController,
  type CaptureControllerDependencies,
} from "./capture-controller"

function bookmarkAdapter(
  overrides: {
    tree?: BookmarkNode[]
    rootFolderId?: string | null
    rootIsCreatable?: boolean
    healthReady?: boolean
    create?: BrowserAdapter["bookmarks"]["create"]
  } = {}
): BrowserAdapter {
  const tree = overrides.tree ?? [
    {
      id: "0",
      title: "",
      children: [
        {
          id: "1",
          title: "Bookmarks Bar",
          children: [{ id: "work", title: "Work", children: [] }],
        },
      ],
    },
  ]
  return {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue(tree),
      getSubTree: vi.fn(),
      create:
        overrides.create ??
        vi.fn().mockResolvedValue({ id: "created", title: "Example" }),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      onChanged: vi.fn(() => vi.fn()),
      onCreated: vi.fn(() => vi.fn()),
      onRemoved: vi.fn(() => vi.fn()),
      onMoved: vi.fn(() => vi.fn()),
      openInManager: vi.fn(),
      checkHealth: vi.fn().mockResolvedValue({
        ready: overrides.healthReady ?? true,
      }),
      dispose: vi.fn(),
    },
    storage: {
      get: vi
        .fn()
        .mockImplementation((key: string) =>
          Promise.resolve(
            key === "rootFolderId" ? (overrides.rootFolderId ?? null) : null
          )
        ),
      set: vi.fn(),
      remove: vi.fn(),
    },
    favicon: { getUrl: vi.fn(), isAvailable: vi.fn(() => false) },
    capabilities: {
      openInManager: false,
      move: true,
      reorder: false,
      setChildOrder: false,
      rootIsCreatable: overrides.rootIsCreatable,
    },
  }
}

function dependencies(
  adapter: BrowserAdapter,
  tab = { title: "Example page", url: "https://example.com/path" }
): CaptureControllerDependencies {
  return {
    getActiveTab: vi.fn().mockResolvedValue(tab),
    selectAdapter: vi.fn().mockResolvedValue({
      adapter,
      source: {
        id: "browser",
        kind: "browser",
        label: "Browser bookmarks",
      },
      choices: [],
    }),
    persistActiveSource: vi.fn().mockResolvedValue(true),
  }
}

describe("CaptureController", () => {
  it("uses the persisted root folder and exposes readable hierarchical paths", async () => {
    const adapter = bookmarkAdapter({ rootFolderId: "work" })
    const controller = new CaptureController(dependencies(adapter))

    await controller.initialize()

    expect(controller.getSnapshot()).toMatchObject({
      phase: "ready",
      title: "Example page",
      url: "https://example.com/path",
      folderId: "work",
      sourceLabel: "Browser bookmarks",
    })
    expect(controller.getSnapshot().folders).toContainEqual({
      id: "work",
      label: "Bookmarks Bar > Work",
    })
    expect(adapter.bookmarks.checkHealth).toHaveBeenCalledOnce()
  })

  it("falls back through resolveCreateParentId when the stored root is stale", async () => {
    const adapter = bookmarkAdapter({ rootFolderId: "deleted" })
    const controller = new CaptureController(dependencies(adapter))

    await controller.initialize()

    expect(controller.getSnapshot().folderId).toBe("1")
  })

  it("rejects non-http pages without constructing an adapter", async () => {
    const adapter = bookmarkAdapter()
    const deps = dependencies(adapter, {
      title: "Extensions",
      url: "chrome://extensions",
    })
    const controller = new CaptureController(deps)

    await controller.initialize()

    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      message: expect.stringContaining("regular http or https page"),
    })
    expect(deps.selectAdapter).not.toHaveBeenCalled()
  })

  it("prevents double submission and never persists the per-capture folder", async () => {
    let finish!: (node: BookmarkNode) => void
    const pending = new Promise<BookmarkNode>((resolve) => {
      finish = resolve
    })
    const create = vi.fn().mockReturnValue(pending)
    const adapter = bookmarkAdapter({ rootFolderId: "work", create })
    const controller = new CaptureController(dependencies(adapter))
    await controller.initialize()
    controller.setFolderId("1")

    const first = controller.submit()
    const second = controller.submit()
    finish({ id: "created", title: "Example page" })
    await Promise.all([first, second])

    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith({
      parentId: "1",
      title: "Example page",
      url: "https://example.com/path",
    })
    expect(adapter.storage.set).not.toHaveBeenCalled()
    expect(controller.getSnapshot()).toMatchObject({
      phase: "success",
      message: "Saved to Bookmarks Bar in Browser bookmarks.",
    })
  })

  it("surfaces an unavailable selected source and disposes adapter resources", async () => {
    const adapter = bookmarkAdapter({ healthReady: false })
    const controller = new CaptureController(dependencies(adapter))

    await controller.initialize()
    expect(controller.getSnapshot()).toMatchObject({
      phase: "error",
      message:
        "The active bookmark source is not ready. Change the destination or retry.",
    })

    controller.dispose()
    controller.dispose()
    expect(adapter.bookmarks.dispose).toHaveBeenCalledOnce()
  })
})
