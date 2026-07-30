// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "./fake-indexeddb"
import { setAdapterModePreference } from "../adapter-preference"
import { detectAdapter } from "../detect"

installFakeIndexedDB()

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
    const adapter = await detectAdapter({ buildTarget: "daemon" })

    expect(adapter.capabilities.reorder).toBe(false)
    expect(adapter.capabilities.setChildOrder).toBe(true)
    expect(typeof adapter.bookmarks.setChildOrder).toBe("function")
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
