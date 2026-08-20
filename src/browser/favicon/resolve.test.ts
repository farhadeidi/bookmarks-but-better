import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "../__tests__/fake-indexeddb"
import { ChromeFaviconAdapter } from "../chrome/favicon"
import { StandaloneFaviconAdapter } from "../standalone/favicon"
import { FaviconCache, type ObjectUrlFactory } from "./cache"
import { FaviconResolver } from "./resolve"

/**
 * The provider order these tests drive is the real one. `StandaloneFaviconAdapter`
 * is Google V2 then Google s2 — the order daemon, standalone and the served web
 * app all use — and `ChromeFaviconAdapter` is the extension's own `_favicon`
 * first. Building the resolver against fakes would have let the two get out of
 * step silently.
 */

const V2_HOST = "https://t1.gstatic.com/faviconV2"
const S2_HOST = "https://www.google.com/s2/favicons"
const NATIVE_HOST = "chrome-extension://extid/_favicon/"
const EXTENSION_ORIGIN = "chrome-extension://extid"

/** The probe page is a host Chrome cannot know; see `chrome-favicon.ts`. */
const PROBE = `${NATIVE_HOST}?pageUrl=${encodeURIComponent("https://favicon-probe.invalid/")}&size=64`

function icon(...values: number[]): Response {
  return new Response(new Uint8Array(values), {
    status: 200,
    headers: { "content-type": "image/png" },
  })
}

function missing(): Response {
  return new Response(null, { status: 404 })
}

/**
 * Routes by URL prefix, and *rejects* for anything unrouted — which is what a
 * fetch this build is not allowed to read actually does.
 */
function router(routes: Array<[string, () => Response]>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    const route = routes.find(([prefix]) => url.startsWith(prefix))
    if (!route) throw new TypeError("Failed to fetch")
    return route[1]()
  })
}

/** Decodes the first byte as the icon's square size, so 16 is Google's globe. */
async function decode(bytes: ArrayBuffer) {
  const size = new Uint8Array(bytes)[0]
  return { width: size, height: size }
}

const objectUrls: ObjectUrlFactory = (() => {
  let next = 0
  return { create: () => `blob:icon-${next++}`, revoke: () => {} }
})()

function build(
  fetchImpl: ReturnType<typeof router>,
  pageOrigin = "http://127.0.0.1:52222"
) {
  const cache = new FaviconCache({ objectUrls })
  const resolver = new FaviconResolver({
    cache,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    decode,
    pageOrigin,
  })
  return { cache, resolver }
}

const google = new StandaloneFaviconAdapter()

beforeEach(() => {
  installFakeIndexedDB()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("cache hits", () => {
  it("serves stored bytes without contacting any provider", async () => {
    const fetchImpl = router([[V2_HOST, () => icon(64)]])
    const { cache, resolver } = build(fetchImpl)
    await cache.putIcon(
      "https://example.com",
      new Uint8Array([64]).buffer,
      "image/png"
    )

    const { sources } = await resolver.resolve(
      "https://example.com/page",
      google
    )

    expect(sources).toHaveLength(1)
    expect(sources[0].startsWith("blob:")).toBe(true)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("stores a provider's bytes so the second load is fully local", async () => {
    const fetchImpl = router([[V2_HOST, () => icon(64)]])
    const { resolver } = build(fetchImpl)

    const first = await resolver.resolve("https://example.com/a", google)
    const second = await resolver.resolve("https://example.com/b", google)

    expect(first.sources[0].startsWith("blob:")).toBe(true)
    expect(second.sources).toEqual(first.sources)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe("deduplication", () => {
  it("makes one lookup for many bookmarks mounting on one site at once", async () => {
    const fetchImpl = router([[V2_HOST, () => icon(64)]])
    const { resolver } = build(fetchImpl)

    const pages = [
      "https://example.com/one",
      "https://example.com/two",
      "https://example.com/three?q=1",
      "https://EXAMPLE.com/four",
    ]
    const results = await Promise.all(
      pages.map((page) => resolver.resolve(page, google))
    )

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    for (const result of results) {
      expect(result.sources).toEqual(results[0].sources)
    }
  })

  it("does not merge lookups for different sites", async () => {
    const fetchImpl = router([[V2_HOST, () => icon(64)]])
    const { resolver } = build(fetchImpl)

    await Promise.all([
      resolver.resolve("https://a.example/", google),
      resolver.resolve("https://b.example/", google),
    ])

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe("Google's default globe", () => {
  it("never caches the globe, and ends at the placeholder", async () => {
    const fetchImpl = router([
      [V2_HOST, () => icon(16)],
      [S2_HOST, () => icon(16)],
    ])
    const { cache, resolver } = build(fetchImpl)

    const { sources } = await resolver.resolve("https://globe.example/", google)

    expect(sources).toEqual([])
    const record = await cache.get("https://globe.example")
    expect(record).not.toBeNull()
    expect(record?.bytes).toBeUndefined()
  })

  it("keeps the globe out of the cache permanently, not just this render", async () => {
    const fetchImpl = router([
      [V2_HOST, () => icon(16)],
      [S2_HOST, () => icon(16)],
    ])
    const { resolver } = build(fetchImpl)

    await resolver.resolve("https://globe.example/", google)
    const again = await resolver.resolve("https://globe.example/other", google)

    // The negative entry answered; no provider was asked a second time.
    expect(again.sources).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("stores a Google response that is not the globe", async () => {
    const fetchImpl = router([[V2_HOST, () => icon(64)]])
    const { cache, resolver } = build(fetchImpl)

    await resolver.resolve("https://real.example/", google)

    const record = await cache.get("https://real.example")
    expect(new Uint8Array(record?.bytes as ArrayBuffer)).toEqual(
      new Uint8Array([64])
    )
  })

  it("hands the URL to the browser when it cannot measure the bytes itself", async () => {
    const fetchImpl = router([[V2_HOST, () => icon(16)]])
    const cache = new FaviconCache({ objectUrls })
    const resolver = new FaviconResolver({
      cache,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      decode: async () => null,
      pageOrigin: "http://127.0.0.1:52222",
    })

    const { sources } = await resolver.resolve("https://example.com/", google)

    // Unverifiable is not "icon": the bytes are not stored, and the `<img>`
    // gets the URL so its own globe check can run, exactly as it always did.
    expect(sources[0].startsWith(V2_HOST)).toBe(true)
    expect(await cache.get("https://example.com")).toBeNull()
  })
})

describe("providers this build may not read", () => {
  it("falls back to the provider URLs when the bytes are not readable", async () => {
    const fetchImpl = router([])
    const { resolver } = build(fetchImpl)

    const { sources } = await resolver.resolve("https://example.com/", google)

    expect(sources).toHaveLength(2)
    expect(sources[0].startsWith(V2_HOST)).toBe(true)
    expect(sources[1].startsWith(S2_HOST)).toBe(true)
  })

  it("learns the limitation once instead of per bookmark", async () => {
    const fetchImpl = router([])
    const { resolver } = build(fetchImpl)

    await resolver.resolve("https://a.example/", google)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    await resolver.resolve("https://b.example/", google)
    await resolver.resolve("https://c.example/", google)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("writes no cache entry it could not verify", async () => {
    const fetchImpl = router([])
    const { cache, resolver } = build(fetchImpl)

    await resolver.resolve("https://example.com/", google)

    expect(await cache.get("https://example.com")).toBeNull()
  })
})

describe("provider misses", () => {
  it("moves to the fallback provider when the first has nothing", async () => {
    const fetchImpl = router([
      [V2_HOST, () => missing()],
      [S2_HOST, () => icon(32)],
    ])
    const { cache, resolver } = build(fetchImpl)

    const { sources } = await resolver.resolve("https://example.com/", google)

    expect(sources[0].startsWith("blob:")).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(await cache.get("https://example.com")).not.toBeNull()
  })

  it("ends at the placeholder and remembers it when every provider misses", async () => {
    const fetchImpl = router([
      [V2_HOST, () => missing()],
      [S2_HOST, () => missing()],
    ])
    const { resolver } = build(fetchImpl)

    expect(
      (await resolver.resolve("https://nothing.example/", google)).sources
    ).toEqual([])

    const again = await resolver.resolve("https://nothing.example/page", google)
    expect(again.sources).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it("refuses a response too large to be a favicon", async () => {
    const oversized = new Uint8Array(300 * 1024)
    oversized[0] = 64
    const fetchImpl = router([
      [
        V2_HOST,
        () =>
          new Response(oversized, {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ],
      [S2_HOST, () => icon(32)],
    ])
    const { cache, resolver } = build(fetchImpl)

    await resolver.resolve("https://huge.example/", google)

    const record = await cache.get("https://huge.example")
    expect(record?.bytes?.byteLength).toBe(1)
  })

  it("reports a page no provider can answer for without asking anyone", async () => {
    const fetchImpl = router([[V2_HOST, () => icon(64)]])
    const { resolver } = build(fetchImpl)

    expect((await resolver.resolve("not a url", google)).sources).toEqual([])
    expect(
      (await resolver.resolve("file:///Users/me/notes.html", google)).sources
    ).toEqual([])
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("a native provider the extension serves itself", () => {
  beforeEach(() => {
    vi.stubGlobal("chrome", { runtime: { id: "extid" } })
  })

  const chrome = new ChromeFaviconAdapter()

  it("prefers the native source and never contacts Google when it answers", async () => {
    const fetchImpl = router([
      [PROBE, () => icon(9, 9, 9)],
      [NATIVE_HOST, () => icon(64, 1, 2)],
      [V2_HOST, () => icon(64)],
    ])
    const { cache, resolver } = build(fetchImpl, EXTENSION_ORIGIN)

    const { sources } = await resolver.resolve("https://example.com/", chrome)

    expect(sources[0].startsWith("blob:")).toBe(true)
    expect(
      fetchImpl.mock.calls.some(([url]) => String(url).startsWith(V2_HOST))
    ).toBe(false)
    expect(
      new Uint8Array(
        (await cache.get("https://example.com"))?.bytes as ArrayBuffer
      )
    ).toEqual(new Uint8Array([64, 1, 2]))
  })

  it("recognizes the native placeholder and goes to Google instead", async () => {
    const fetchImpl = router([
      [PROBE, () => icon(9, 9, 9)],
      [NATIVE_HOST, () => icon(9, 9, 9)],
      [V2_HOST, () => icon(64)],
    ])
    const { cache, resolver } = build(fetchImpl, EXTENSION_ORIGIN)

    await resolver.resolve("https://unknown.example/", chrome)

    // The placeholder was not stored — Google's real icon was.
    expect(
      new Uint8Array(
        (await cache.get("https://unknown.example"))?.bytes as ArrayBuffer
      )
    ).toEqual(new Uint8Array([64]))
  })

  it("samples the placeholder once for the whole session", async () => {
    const fetchImpl = router([
      [PROBE, () => icon(9, 9, 9)],
      [NATIVE_HOST, () => icon(64, 1)],
    ])
    const { resolver } = build(fetchImpl, EXTENSION_ORIGIN)

    await resolver.resolve("https://a.example/", chrome)
    await resolver.resolve("https://b.example/", chrome)
    await resolver.resolve("https://c.example/", chrome)

    const probeCalls = fetchImpl.mock.calls.filter(
      ([url]) => String(url) === PROBE
    )
    expect(probeCalls).toHaveLength(1)
  })

  it("skips the native source entirely when the placeholder cannot be sampled", async () => {
    const fetchImpl = router([
      [`${NATIVE_HOST}?pageUrl=https%3A%2F%2Fexample.com`, () => icon(1, 2)],
      [V2_HOST, () => icon(64)],
    ])
    const { cache, resolver } = build(fetchImpl, EXTENSION_ORIGIN)

    await resolver.resolve("https://example.com/", chrome)

    // Without a sample a native response cannot be told from a placeholder, so
    // it is dropped rather than cached as if it were the site's icon.
    expect(
      new Uint8Array(
        (await cache.get("https://example.com"))?.bytes as ArrayBuffer
      )
    ).toEqual(new Uint8Array([64]))
  })
})

describe("misses reported by the UI", () => {
  it("remembers a source that only failed once the browser rendered it", async () => {
    const fetchImpl = router([])
    const { resolver } = build(fetchImpl)

    const first = await resolver.resolve("https://example.com/", google)
    expect(first.sources).toHaveLength(2)

    await resolver.reportMiss("https://example.com/page")

    expect(
      (await resolver.resolve("https://example.com/", google)).sources
    ).toEqual([])
  })

  it("ignores a page that has no key", async () => {
    const { resolver } = build(router([]))
    await expect(resolver.reportMiss("not a url")).resolves.toBeUndefined()
  })
})

describe("failure tolerance", () => {
  it("still shows the icon when the cache itself is unusable", async () => {
    const fetchImpl = router([[V2_HOST, () => icon(64)]])
    const { resolver } = build(fetchImpl)
    // No IndexedDB at all: a profile with storage locked down.
    vi.stubGlobal("indexedDB", undefined)

    const { sources } = await resolver.resolve("https://example.com/", google)

    expect(sources[0].startsWith("blob:")).toBe(true)
  })

  it("still shows the letter when the cache is unusable and nobody answers", async () => {
    const { resolver } = build(
      router([
        [V2_HOST, () => missing()],
        [S2_HOST, () => missing()],
      ])
    )
    vi.stubGlobal("indexedDB", undefined)

    expect(
      (await resolver.resolve("https://nothing.example/", google)).sources
    ).toEqual([])
  })
})
