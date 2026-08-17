import { beforeEach, describe, expect, it, vi } from "vitest"
import { useBookmarkStore } from "../bookmark-store"
import type { BrowserAdapter } from "@/browser"

/**
 * The session-lifecycle regression suite: what a Source Session owes even
 * when its first load fails. A failed `init` must not leave the session
 * deaf (no adapter-event subscriptions, so a `retry()` that recovers can
 * never refresh on changes) or leak the adapter (its SSE stream and
 * reconnect timers survive teardown) — the failure path owns the same
 * listener registration and disposal as the success path.
 */

function sessionAdapter() {
  const listeners = {
    changed: new Set<() => void>(),
    created: new Set<() => void>(),
    removed: new Set<() => void>(),
    moved: new Set<() => void>(),
  }
  const dispose = vi.fn()
  const adapter: BrowserAdapter = {
    bookmarks: {
      getTree: vi.fn(),
      getSubTree: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({
        id: "n1",
        title: "New",
        url: "https://n.example",
      }),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      onChanged: (cb: () => void) => {
        listeners.changed.add(cb)
        return () => listeners.changed.delete(cb)
      },
      onCreated: (cb: () => void) => {
        listeners.created.add(cb)
        return () => listeners.created.delete(cb)
      },
      onRemoved: (cb: () => void) => {
        listeners.removed.add(cb)
        return () => listeners.removed.delete(cb)
      },
      onMoved: (cb: () => void) => {
        listeners.moved.add(cb)
        return () => listeners.moved.delete(cb)
      },
      openInManager: vi.fn(),
      dispose,
    },
    storage: {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    favicon: { getUrl: vi.fn(() => ""), isAvailable: vi.fn(() => false) },
    capabilities: {
      openInManager: false,
      move: true,
      reorder: false,
      setChildOrder: false,
    },
  }
  return { adapter, listeners, dispose }
}

function totalListeners(l: ReturnType<typeof sessionAdapter>["listeners"]) {
  return l.changed.size + l.created.size + l.removed.size + l.moved.size
}

/** The store debounces event-driven refreshes at 100ms; let them land. */
function settleDebounce() {
  return new Promise((resolve) => setTimeout(resolve, 150))
}

beforeEach(() => {
  vi.clearAllMocks()
  useBookmarkStore.setState({
    tree: [],
    rootFolderId: null,
    isLoading: true,
    adapter: null,
    status: "loading",
    loadError: null,
    mutationError: null,
    rootFolder: null,
  })
})

describe("bookmark-store failed-init session lifecycle", () => {
  it("a session recovered by retry() still refreshes its tree on adapter events", async () => {
    const firstLoad = [{ id: "root", title: "Root", children: [] }] as const
    const afterCreate = [
      {
        id: "root",
        title: "Root",
        children: [{ id: "n1", title: "New", url: "https://n.example" }],
      },
    ] as const
    const { adapter, listeners } = sessionAdapter()
    adapter.bookmarks.getTree = vi
      .fn()
      .mockRejectedValueOnce(new Error("daemon offline"))
      .mockResolvedValueOnce([...firstLoad])
      .mockResolvedValueOnce([...afterCreate])

    const cleanup = await useBookmarkStore.getState().init(adapter)
    expect(useBookmarkStore.getState().status).toBe("unavailable")

    // The daemon comes back; retry recovers the tree...
    await useBookmarkStore.getState().retry()
    expect(useBookmarkStore.getState().status).toBe("ready")
    expect(useBookmarkStore.getState().tree).toEqual([...firstLoad])

    // ...and the session must still be subscribed: a mutation refreshes the
    // tree only because the adapter's created event reaches the store.
    await useBookmarkStore
      .getState()
      .createBookmark("root", "New", "https://n.example")
    for (const cb of listeners.created) cb()
    await settleDebounce()

    expect(adapter.bookmarks.getTree).toHaveBeenCalledTimes(3)
    expect(useBookmarkStore.getState().tree).toEqual([...afterCreate])
    // One subscription per event — retry() repairs the session, it must not
    // duplicate it.
    expect(listeners.changed.size).toBe(1)
    expect(listeners.created.size).toBe(1)
    expect(listeners.removed.size).toBe(1)
    expect(listeners.moved.size).toBe(1)

    cleanup?.()
  })

  it("an external change event also refreshes a session whose init failed", async () => {
    const externalTree = [
      {
        id: "root",
        title: "Root",
        children: [{ id: "x1", title: "Elsewhere" }],
      },
    ] as const
    const { adapter, listeners } = sessionAdapter()
    adapter.bookmarks.getTree = vi
      .fn()
      .mockRejectedValueOnce(new Error("daemon offline"))
      .mockResolvedValueOnce([{ id: "root", title: "Root", children: [] }])
      .mockResolvedValueOnce([...externalTree])

    const cleanup = await useBookmarkStore.getState().init(adapter)
    await useBookmarkStore.getState().retry()

    for (const cb of listeners.changed) cb()
    await settleDebounce()

    expect(useBookmarkStore.getState().tree).toEqual([...externalTree])
    cleanup?.()
  })

  it("the cleanup returned by a failed init unsubscribes the listeners and disposes the adapter", async () => {
    const { adapter, listeners, dispose } = sessionAdapter()
    adapter.bookmarks.getTree = vi
      .fn()
      .mockRejectedValue(new Error("daemon offline"))

    const cleanup = await useBookmarkStore.getState().init(adapter)
    expect(useBookmarkStore.getState().status).toBe("unavailable")

    // The session owned subscriptions despite the failed load...
    expect(totalListeners(listeners)).toBe(4)

    cleanup?.()
    // ...so its cleanup must tear them down and dispose the adapter (SSE
    // stream included) instead of being the init-failure no-op.
    expect(totalListeners(listeners)).toBe(0)
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
