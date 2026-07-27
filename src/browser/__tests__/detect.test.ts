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
