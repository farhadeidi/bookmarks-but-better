// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { createAdapterForSource, createStandaloneAdapter } from "./adapters"
import { describeSource } from "./descriptors"

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

function dispose(adapter: { bookmarks: { dispose?: () => void } }) {
  adapter.bookmarks.dispose?.()
}

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

describe("createAdapterForSource", () => {
  it("builds the Chromium adapter for a browser source outside Gecko", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    })

    const adapter = createAdapterForSource(
      describeSource("browser", { enabled: true })
    )

    expect(adapter.bookmarks.constructor.name).toBe("ChromeBookmarkAdapter")
  })

  it("builds the Firefox adapter for a browser source inside Gecko", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
    })

    const adapter = createAdapterForSource(
      describeSource("browser", { enabled: true })
    )

    expect(adapter.bookmarks.constructor.name).toBe("FirefoxBookmarkAdapter")
  })

  it("builds the standalone adapter for the legacy source", () => {
    const adapter = createAdapterForSource(
      describeSource("standalone", { enabled: true, legacy: true })
    )
    expect(adapter.bookmarks.constructor.name).toBe("StandaloneBookmarkAdapter")
  })

  it("builds a vault-scoped daemon adapter whose stream names the vault", () => {
    stubDaemonFetch()

    const descriptor = describeSource("daemon:http://127.0.0.1:47321#reading", {
      enabled: true,
      origin: "http://127.0.0.1:47321",
      vaultId: "reading",
    })
    const adapter = createAdapterForSource(descriptor, {
      "http://127.0.0.1:47321": { bearerToken: "secret" },
    })

    expect(adapter.bookmarks.constructor.name).toBe("DaemonBookmarkAdapter")
    const [eventsUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(eventsUrl).toBe(
      "http://127.0.0.1:47321/api/v1/vaults/reading/events"
    )
    dispose(adapter)
  })

  it("the served app's daemon source stays same-origin but vault-scoped", () => {
    stubDaemonFetch()

    const descriptor = describeSource("daemon:#main", {
      enabled: true,
      origin: "",
      vaultId: "main",
    })
    const adapter = createAdapterForSource(descriptor)

    const [eventsUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(eventsUrl).toBe("/api/v1/vaults/main/events")
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
  it("daemon: reorder stays false while setChildOrder is true", () => {
    stubDaemonFetch()
    const adapter = createAdapterForSource(
      describeSource("daemon:#main", {
        enabled: true,
        origin: "",
        vaultId: "main",
      })
    )

    expect(adapter.capabilities.reorder).toBe(false)
    expect(adapter.capabilities.setChildOrder).toBe(true)
    expect(typeof adapter.bookmarks.setChildOrder).toBe("function")
    dispose(adapter)
  })

  it("chrome: setChildOrder is false and the adapter has no such method", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
    })
    const adapter = createAdapterForSource(
      describeSource("browser", { enabled: true })
    )

    expect(adapter.capabilities.reorder).toBe(true)
    expect(adapter.capabilities.setChildOrder).toBe(false)
    expect(adapter.bookmarks.setChildOrder).toBeUndefined()
  })

  it("firefox: setChildOrder is false and the adapter has no such method", () => {
    vi.stubGlobal("navigator", {
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0",
    })
    const adapter = createAdapterForSource(
      describeSource("browser", { enabled: true })
    )

    expect(adapter.bookmarks.constructor.name).toBe("FirefoxBookmarkAdapter")
    expect(adapter.capabilities.reorder).toBe(true)
    expect(adapter.capabilities.setChildOrder).toBe(false)
    expect(adapter.bookmarks.setChildOrder).toBeUndefined()
  })

  it("standalone: setChildOrder is false and the adapter has no such method", () => {
    const adapter = createStandaloneAdapter()

    expect(adapter.bookmarks.constructor.name).toBe("StandaloneBookmarkAdapter")
    expect(adapter.capabilities.reorder).toBe(true)
    expect(adapter.capabilities.setChildOrder).toBe(false)
    expect(adapter.bookmarks.setChildOrder).toBeUndefined()
  })
})

describe("legacy-protocol daemon connections", () => {
  it("an unscoped entry builds an unscoped client, even with a vault id recorded", () => {
    stubDaemonFetch()

    const descriptor = describeSource("daemon:http://127.0.0.1:52222#default", {
      enabled: true,
      origin: "http://127.0.0.1:52222",
      vaultId: "default",
      unscoped: true,
    })
    const adapter = createAdapterForSource(descriptor)

    // The change stream names no vault: the daemon this profile migrated
    // from predates Vault ids and would 404 every scoped request.
    const [eventsUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(eventsUrl).toBe("http://127.0.0.1:52222/api/v1/events")
    dispose(adapter)
  })

  it("a scoped entry builds a vault-scoped client", () => {
    stubDaemonFetch()

    const descriptor = describeSource("daemon:http://127.0.0.1:52222#main", {
      enabled: true,
      origin: "http://127.0.0.1:52222",
      vaultId: "main",
    })
    const adapter = createAdapterForSource(descriptor)

    const [eventsUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(eventsUrl).toBe("http://127.0.0.1:52222/api/v1/vaults/main/events")
    dispose(adapter)
  })
})
