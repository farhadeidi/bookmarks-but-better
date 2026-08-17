// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import type { BookmarkNode, BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { useUIStore } from "@/stores/ui-store"
import {
  enabledSourceDescriptors,
  resetSourceSession,
  useSourceStore,
} from "./source-store"
import { daemonSourceId } from "@/sources/config"

installFakeIndexedDB()

// The concrete adapters are the seam this suite controls: each test decides
// which adapter a source id builds and what it does.
vi.mock("@/sources/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/adapters")>()
  return {
    ...actual,
    createAdapterForSource: vi.fn(),
  }
})

// Connecting is persistence-free by design; the store test intercepts the
// network-facing flow entirely.
vi.mock("@/browser/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/browser/daemon")>()
  return {
    ...actual,
    connectToDaemon: vi.fn(),
    removeDaemonHostPermission: vi.fn().mockResolvedValue(undefined),
  }
})

const { createAdapterForSource } = await import("@/sources/adapters")
const { connectToDaemon, removeDaemonHostPermission } =
  await import("@/browser/daemon")

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function mockAdapter() {
  const listeners = {
    changed: new Set<() => void>(),
    created: new Set<() => void>(),
    removed: new Set<() => void>(),
    moved: new Set<() => void>(),
  }
  const tree = deferred<BookmarkNode[]>()
  const dispose = vi.fn()
  const adapter: BrowserAdapter = {
    bookmarks: {
      getTree: vi.fn(() => tree.promise),
      getSubTree: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
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
      reorder: true,
      setChildOrder: false,
    },
  }
  return { adapter, listeners, tree, dispose }
}

function listenerCount(listeners: ReturnType<typeof mockAdapter>["listeners"]) {
  return (
    listeners.changed.size +
    listeners.created.size +
    listeners.removed.size +
    listeners.moved.size
  )
}

const ORIGIN = "http://127.0.0.1:52222"
const DAEMON_ID = daemonSourceId(ORIGIN, "main")

/**
 * Seeds a profile whose Active Source is the daemon vault, so every test's
 * first switch (to `browser`) is a real transition rather than a no-op.
 */
function seedConfig() {
  useSourceStore.setState({
    status: "ready",
    switching: false,
    lastSwitchError: null,
    activeSourceId: DAEMON_ID,
    config: {
      version: 2,
      connections: { [ORIGIN]: {} },
      sources: {
        browser: { enabled: true },
        [DAEMON_ID]: { enabled: true, origin: ORIGIN, vaultId: "main" },
      },
      activeSourceId: DAEMON_ID,
    },
  })
}

/** Starts a switch whose tree load is already satisfied. */
async function switchSettled(
  id: string,
  source: ReturnType<typeof mockAdapter>,
  tree: BookmarkNode[] = []
) {
  source.tree.resolve(tree)
  await useSourceStore.getState().switchSource(id)
}

beforeEach(() => {
  installFakeIndexedDB()
  resetSourceSession()
  vi.clearAllMocks()
  // A desktop extension context, so normalization keeps the Browser Source
  // these tests seed.
  vi.stubGlobal("chrome", { bookmarks: {}, storage: {} })
  seedConfig()
  useUIStore.setState({ bookmarkOrganizerOpen: false })
})

afterEach(() => {
  resetSourceSession()
  vi.unstubAllGlobals()
})

describe("the Source Session transition", () => {
  it("switches the active source, re-initializing stores against the new adapter", async () => {
    const browser = mockAdapter()
    const daemon = mockAdapter()
    vi.mocked(createAdapterForSource).mockImplementation((source) =>
      source.id === "browser" ? browser.adapter : daemon.adapter
    )

    await switchSettled("browser", browser, [
      { id: "root", title: "Browser root", children: [] },
    ])
    expect(useBookmarkStore.getState().adapter).toBe(browser.adapter)
    expect(useSourceStore.getState().activeSourceId).toBe("browser")

    await switchSettled(DAEMON_ID, daemon, [
      { id: "vault", title: "Vault", children: [] },
    ])

    expect(useSourceStore.getState().activeSourceId).toBe(DAEMON_ID)
    expect(useBookmarkStore.getState().adapter).toBe(daemon.adapter)
    expect(useBookmarkStore.getState().tree[0]?.id).toBe("vault")
  })

  it("disposes the previous session's adapter and listeners (SSE included)", async () => {
    const browser = mockAdapter()
    const daemon = mockAdapter()
    vi.mocked(createAdapterForSource).mockImplementation((source) =>
      source.id === "browser" ? browser.adapter : daemon.adapter
    )

    await switchSettled("browser", browser)
    expect(listenerCount(browser.listeners)).toBe(4)
    expect(browser.dispose).not.toHaveBeenCalled()

    await switchSettled(DAEMON_ID, daemon)

    expect(browser.dispose).toHaveBeenCalledTimes(1)
    expect(listenerCount(browser.listeners)).toBe(0)
    expect(listenerCount(daemon.listeners)).toBe(4)
  })

  it("closes node-bound UI when switching", async () => {
    const browser = mockAdapter()
    const daemon = mockAdapter()
    vi.mocked(createAdapterForSource).mockImplementation((source) =>
      source.id === "browser" ? browser.adapter : daemon.adapter
    )

    await switchSettled("browser", browser)

    useUIStore.setState({ bookmarkOrganizerOpen: true })
    await switchSettled(DAEMON_ID, daemon)

    expect(useUIStore.getState().bookmarkOrganizerOpen).toBe(false)
  })

  it("refuses a second switch while one is in progress (re-entrancy)", async () => {
    const browser = mockAdapter()
    const daemon = mockAdapter()
    vi.mocked(createAdapterForSource).mockImplementation((source) =>
      source.id === "browser" ? browser.adapter : daemon.adapter
    )

    // A pending switch to the browser (its tree is still unresolved).
    const first = useSourceStore.getState().switchSource("browser")
    const refused = await useSourceStore.getState().switchSource("browser")

    expect(refused).toBeUndefined()
    expect(useSourceStore.getState().lastSwitchError).toContain("switching")

    browser.tree.resolve([])
    await first
    expect(useSourceStore.getState().activeSourceId).toBe("browser")
  })

  it("expires stale async work from a superseded transition", async () => {
    const browser = mockAdapter()
    const slow = mockAdapter() // its tree will resolve only after being superseded
    vi.mocked(createAdapterForSource).mockImplementation((source) =>
      source.id === "browser" ? browser.adapter : slow.adapter
    )

    // Start this test with Browser active, so the stalled switch targets the
    // daemon vault and stalls on its pending tree load.
    useSourceStore.setState({
      activeSourceId: "browser",
      config: {
        ...useSourceStore.getState().config,
        activeSourceId: "browser",
      },
    })
    const stalled = useSourceStore.getState().switchSource(DAEMON_ID)

    // Meanwhile the connection is forgotten — a transition through a
    // different entry point, which supersedes the stalled one.
    const forgotten = useSourceStore.getState().forgetDaemon(ORIGIN)
    browser.tree.resolve([])
    await forgotten
    expect(useBookmarkStore.getState().adapter).toBe(browser.adapter)

    // Only now does the stalled transition's tree resolve. The session
    // token must keep it from applying: its listeners were never installed
    // and its adapter is disposed.
    slow.tree.resolve([{ id: "stale", title: "Stale", children: [] }])
    await stalled

    expect(useBookmarkStore.getState().tree[0]?.id).toBeUndefined()
    expect(useBookmarkStore.getState().adapter).toBe(browser.adapter)
    expect(slow.dispose).toHaveBeenCalledTimes(1)
    expect(listenerCount(slow.listeners)).toBe(0)
  })

  it("never falls back when the active daemon source cannot load", async () => {
    const browser = mockAdapter()
    const daemon = mockAdapter()
    vi.mocked(createAdapterForSource).mockImplementation((source) =>
      source.id === "browser" ? browser.adapter : daemon.adapter
    )

    browser.tree.resolve([])
    await useSourceStore.getState().switchSource("browser")

    // Switching to the broken daemon keeps it selected and reports the
    // failure rather than quietly serving the previous source.
    const back = useSourceStore.getState().switchSource(DAEMON_ID)
    // Reject only once the transition is consuming the daemon's tree, so the
    // rejection always has a handler in the same tick it occurs.
    await vi.waitFor(() => {
      expect(daemon.adapter.bookmarks.getTree).toHaveBeenCalled()
    })
    daemon.tree.reject(new Error("daemon unreachable"))
    await back

    expect(useSourceStore.getState().activeSourceId).toBe(DAEMON_ID)
    expect(useBookmarkStore.getState().status).toBe("unavailable")
    expect(useBookmarkStore.getState().adapter).toBe(daemon.adapter)
  })

  it("refuses to disable the last enabled source and reports why", async () => {
    useSourceStore.setState({
      config: {
        version: 2,
        connections: {},
        sources: { browser: { enabled: true } },
        activeSourceId: "browser",
      },
      activeSourceId: "browser",
    })

    const applied = await useSourceStore
      .getState()
      .setSourceEnabled("browser", false)
    expect(applied).toBe(false)
    expect(useSourceStore.getState().config.sources.browser?.enabled).toBe(true)
  })

  it("disabling the active source transitions to the next enabled one", async () => {
    const browser = mockAdapter()
    const daemon = mockAdapter()
    vi.mocked(createAdapterForSource).mockImplementation((source) =>
      source.id === "browser" ? browser.adapter : daemon.adapter
    )

    // The daemon is the seeded active source; give it a live session.
    await switchSettled(DAEMON_ID, daemon)

    // The browser tree is satisfied up front: the disable's transition to
    // browser will await it.
    browser.tree.resolve([])
    const applied = await useSourceStore
      .getState()
      .setSourceEnabled(DAEMON_ID, false)
    expect(applied).toBe(true)
    await vi.waitFor(() => {
      expect(useBookmarkStore.getState().adapter).toBe(browser.adapter)
    })
    expect(useSourceStore.getState().activeSourceId).toBe("browser")
    // Configuration retained, not forgotten.
    expect(useSourceStore.getState().config.sources[DAEMON_ID]).toMatchObject({
      enabled: false,
      origin: ORIGIN,
    })
  })
})

describe("connecting a daemon", () => {
  it("creates one source per discovered vault, enables them, and switches to the first", async () => {
    const daemon = mockAdapter()
    vi.mocked(createAdapterForSource).mockReturnValue(daemon.adapter)
    vi.mocked(connectToDaemon).mockResolvedValue({
      ok: true,
      origin: "http://localhost:52223",
      warnings: [],
      vaults: [
        { id: "reading", name: "Reading" },
        { id: "archive", name: "Archive" },
      ],
      legacyProtocol: false,
    })

    daemon.tree.resolve([])
    const result = await useSourceStore
      .getState()
      .connectDaemon("localhost:52223")
    expect(result.ok).toBe(true)

    const config = useSourceStore.getState().config
    expect(
      config.sources[daemonSourceId("http://localhost:52223", "reading")]
    ).toMatchObject({ enabled: true, vaultId: "reading", name: "Reading" })
    expect(
      config.sources[daemonSourceId("http://localhost:52223", "archive")]
    ).toMatchObject({ enabled: true, vaultId: "archive" })
    // Browser stayed enabled; the first vault became active.
    expect(config.sources.browser?.enabled).toBe(true)
    expect(useSourceStore.getState().activeSourceId).toBe(
      daemonSourceId("http://localhost:52223", "reading")
    )
    expect(useBookmarkStore.getState().adapter).toBe(daemon.adapter)
  })

  it("a failed connect persists nothing", async () => {
    const before = useSourceStore.getState().config
    vi.mocked(connectToDaemon).mockResolvedValue({
      ok: false,
      stage: "health",
      message: "unreachable",
    })

    const result = await useSourceStore
      .getState()
      .connectDaemon("127.0.0.1:59999")
    expect(result.ok).toBe(false)
    expect(useSourceStore.getState().config).toEqual(before)
  })
})

describe("forgetting a daemon connection", () => {
  it("removes the connection and its sources, and transitions if active moved", async () => {
    const browser = mockAdapter()
    const daemon = mockAdapter()
    vi.mocked(createAdapterForSource).mockImplementation((source) =>
      source.id === "browser" ? browser.adapter : daemon.adapter
    )

    const pending = useSourceStore.getState().forgetDaemon(ORIGIN)
    browser.tree.resolve([])
    await pending

    const config = useSourceStore.getState().config
    expect(config.connections[ORIGIN]).toBeUndefined()
    expect(config.sources[DAEMON_ID]).toBeUndefined()
    expect(useSourceStore.getState().activeSourceId).toBe("browser")
    expect(useBookmarkStore.getState().adapter).toBe(browser.adapter)
    // The last connection going away is what releases the permission.
    expect(removeDaemonHostPermission).toHaveBeenCalledTimes(1)
  })

  it("keeps the shared host permission while another connection remains", async () => {
    const otherOrigin = "http://localhost:52223"
    const otherId = daemonSourceId(otherOrigin, "main")
    useSourceStore.setState({
      config: {
        version: 2,
        connections: { [ORIGIN]: {}, [otherOrigin]: {} },
        sources: {
          browser: { enabled: true },
          [DAEMON_ID]: { enabled: true, origin: ORIGIN, vaultId: "main" },
          [otherId]: { enabled: true, origin: otherOrigin, vaultId: "main" },
        },
        activeSourceId: DAEMON_ID,
      },
    })
    const browser = mockAdapter()
    const daemon = mockAdapter()
    vi.mocked(createAdapterForSource).mockImplementation((source) =>
      source.id === "browser" ? browser.adapter : daemon.adapter
    )

    // Forgetting one of two connections must not strip the loopback host
    // permission the surviving connection's sources still depend on.
    const pending = useSourceStore.getState().forgetDaemon(ORIGIN)
    browser.tree.resolve([])
    await pending

    expect(useSourceStore.getState().config.connections).toEqual({
      [otherOrigin]: {},
    })
    expect(useSourceStore.getState().config.sources[otherId]).toMatchObject({
      origin: otherOrigin,
    })
    expect(removeDaemonHostPermission).not.toHaveBeenCalled()

    // The last one going away does release it.
    await useSourceStore.getState().forgetDaemon(otherOrigin)
    expect(removeDaemonHostPermission).toHaveBeenCalledTimes(1)
  })
})

describe("selectors", () => {
  it("describes the enabled sources for the switcher", () => {
    const sources = enabledSourceDescriptors(useSourceStore.getState())
    expect(sources.map((s) => s.id)).toEqual(["browser", DAEMON_ID])
    expect(sources[1].kind).toBe("daemon")
    expect(sources[1].vaultId).toBe("main")
  })
})

describe("teardown", () => {
  it("the last enabled source cannot be disabled, so the session is never torn down by mistake", async () => {
    useSourceStore.setState({
      config: {
        version: 2,
        connections: { [ORIGIN]: {} },
        sources: {
          [DAEMON_ID]: { enabled: true, origin: ORIGIN, vaultId: "main" },
        },
        activeSourceId: DAEMON_ID,
      },
    })

    const applied = await useSourceStore
      .getState()
      .setSourceEnabled(DAEMON_ID, false)
    expect(applied).toBe(false)
  })
})
