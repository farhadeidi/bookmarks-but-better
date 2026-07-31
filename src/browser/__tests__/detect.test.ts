// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "./fake-indexeddb"
import {
  setAdapterModePreference,
  setDaemonConnectionConfig,
} from "../adapter-preference"
import { detectAdapter } from "../detect"
import type { BrowserAdapter } from "../types"

installFakeIndexedDB()

/**
 * A daemon adapter opens its change stream as soon as it is constructed, so
 * every test that builds one stubs `fetch` (nothing here should touch the
 * network) and disposes the adapter (nothing should outlive its test).
 */
function stubDaemonFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(() => new Promise(() => {}))
  )
}

function dispose(adapter: BrowserAdapter) {
  adapter.bookmarks.dispose?.()
}

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

describe("detectAdapter", () => {
  it("honors a standalone preference even inside a browser-extension context", async () => {
    vi.stubGlobal("chrome", {
      bookmarks: {},
      storage: {
        local: { get: vi.fn(), set: vi.fn() },
        sync: { get: vi.fn() },
      },
    })

    await setAdapterModePreference("standalone")

    const adapter = await detectAdapter()

    expect(adapter.bookmarks.constructor.name).toBe("StandaloneBookmarkAdapter")
  })

  it("falls back to the browser adapter in an extension context with no stored preference", async () => {
    vi.stubGlobal("chrome", {
      bookmarks: {},
      storage: {
        local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
        sync: { get: vi.fn().mockResolvedValue({}) },
      },
    })

    const adapter = await detectAdapter()

    expect(adapter.bookmarks.constructor.name).toBe("ChromeBookmarkAdapter")
  })

  it("always selects the daemon adapter in a daemon build, ignoring any stored preference or extension context", async () => {
    stubDaemonFetch()
    vi.stubGlobal("chrome", {
      bookmarks: {},
      storage: {
        local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
        sync: { get: vi.fn().mockResolvedValue({}) },
      },
    })
    await setAdapterModePreference("standalone")

    const adapter = await detectAdapter({ buildTarget: "daemon" })

    expect(adapter.bookmarks.constructor.name).toBe("DaemonBookmarkAdapter")
    expect(adapter.capabilities.move).toBe(true)
    expect(adapter.capabilities.reorder).toBe(false)
    dispose(adapter)
  })

  it("builds an extension daemon adapter from the stored endpoint when the preference is `daemon`", async () => {
    stubDaemonFetch()
    vi.stubGlobal("chrome", {
      bookmarks: {},
      storage: {
        local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
        sync: { get: vi.fn().mockResolvedValue({}) },
      },
    })
    await setAdapterModePreference("daemon")
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:47321" })

    const adapter = await detectAdapter()

    expect(adapter.bookmarks.constructor.name).toBe("DaemonBookmarkAdapter")
    // The change stream — the first request an adapter makes — proves which
    // endpoint the whole client was built against.
    const [eventsUrl] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(eventsUrl).toBe("http://127.0.0.1:47321/api/v1/events")
    dispose(adapter)
  })

  it("falls back to the default 52222 endpoint when daemon mode is chosen but nothing is configured", async () => {
    stubDaemonFetch()
    await setAdapterModePreference("daemon")

    const adapter = await detectAdapter()

    const [eventsUrl] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(eventsUrl).toBe("http://127.0.0.1:52222/api/v1/events")
    dispose(adapter)
  })

  it("never falls back to browser bookmarks when daemon mode is chosen, even in an extension context", async () => {
    stubDaemonFetch()
    vi.stubGlobal("chrome", {
      bookmarks: {},
      storage: {
        local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
        sync: { get: vi.fn().mockResolvedValue({}) },
      },
    })
    await setAdapterModePreference("daemon")

    // A daemon that is not running must surface as an error the user can act
    // on. Silently serving browser bookmarks instead would show a *different
    // set of bookmarks* and read as data loss.
    const adapter = await detectAdapter()

    expect(adapter.bookmarks.constructor.name).toBe("DaemonBookmarkAdapter")
    dispose(adapter)
  })

  it("keeps the served daemon build same-origin, ignoring any stored extension endpoint", async () => {
    stubDaemonFetch()
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:47321" })

    const adapter = await detectAdapter({ buildTarget: "daemon" })

    const [eventsUrl] = vi.mocked(globalThis.fetch).mock.calls[0]
    expect(eventsUrl).toBe("/api/v1/events")
    dispose(adapter)
  })
})

/**
 * The regression guard for "ordering lives ONLY in the Bookmark Organizer".
 *
 * `reorder` is what the grid, the folder cards and `experimentalCardDrag`
 * consult, and every one of them routes through `move(id, {index})`, which the
 * daemon ignores by design. Flipping it to `true` "for consistency" would make
 * all three look enabled while writing nothing. `setChildOrder` is the separate
 * capability the organizer alone reads, and no extension adapter can honour it.
 */
describe("ordering capability isolation", () => {
  function stubExtensionContext() {
    vi.stubGlobal("chrome", {
      bookmarks: {},
      storage: {
        local: { get: vi.fn().mockResolvedValue({}), set: vi.fn() },
        sync: { get: vi.fn().mockResolvedValue({}) },
      },
    })
  }

  it("daemon: reorder stays false while setChildOrder is true", async () => {
    stubDaemonFetch()
    const adapter = await detectAdapter({ buildTarget: "daemon" })

    expect(adapter.capabilities.reorder).toBe(false)
    expect(adapter.capabilities.setChildOrder).toBe(true)
    expect(typeof adapter.bookmarks.setChildOrder).toBe("function")
    dispose(adapter)
  })

  it("chrome: setChildOrder is false and the adapter has no such method", async () => {
    stubExtensionContext()

    const adapter = await detectAdapter()

    expect(adapter.bookmarks.constructor.name).toBe("ChromeBookmarkAdapter")
    expect(adapter.capabilities.reorder).toBe(true)
    expect(adapter.capabilities.setChildOrder).toBe(false)
    expect(adapter.bookmarks.setChildOrder).toBeUndefined()
  })

  it("firefox: setChildOrder is false and the adapter has no such method", async () => {
    stubExtensionContext()

    const adapter = await detectAdapter({ buildTarget: "firefox" })

    expect(adapter.bookmarks.constructor.name).toBe("FirefoxBookmarkAdapter")
    expect(adapter.capabilities.reorder).toBe(true)
    expect(adapter.capabilities.setChildOrder).toBe(false)
    expect(adapter.bookmarks.setChildOrder).toBeUndefined()
  })

  it("standalone: setChildOrder is false and the adapter has no such method", async () => {
    await setAdapterModePreference("standalone")

    const adapter = await detectAdapter()

    expect(adapter.bookmarks.constructor.name).toBe("StandaloneBookmarkAdapter")
    expect(adapter.capabilities.reorder).toBe(true)
    expect(adapter.capabilities.setChildOrder).toBe(false)
    expect(adapter.bookmarks.setChildOrder).toBeUndefined()
  })
})
