import { beforeEach, describe, expect, it } from "vitest"
import { installFakeIndexedDB } from "../__tests__/fake-indexeddb"
import {
  FAVICON_MAX_ENTRIES,
  FAVICON_MISS_TTL_MS,
  FAVICON_TRIM_TO,
  FAVICON_TTL_MS,
  FaviconCache,
  type ObjectUrlFactory,
} from "./cache"

function bytes(...values: number[]): ArrayBuffer {
  return new Uint8Array(values).buffer
}

/** An object-URL factory that remembers what it handed out and took back. */
function trackingUrls() {
  const created: string[] = []
  const revoked: string[] = []
  let next = 0
  const factory: ObjectUrlFactory = {
    create: () => {
      const url = `blob:icon-${next++}`
      created.push(url)
      return url
    },
    revoke: (url) => {
      revoked.push(url)
    },
  }
  return { factory, created, revoked }
}

let clock = 1_000_000

function makeCache(objectUrls?: ObjectUrlFactory) {
  return new FaviconCache({ now: () => clock, objectUrls })
}

beforeEach(() => {
  installFakeIndexedDB()
  clock = 1_000_000
})

describe("FaviconCache storage", () => {
  it("round-trips icon bytes", async () => {
    const cache = makeCache()
    await cache.putIcon("https://example.com", bytes(1, 2, 3), "image/png")

    const record = await cache.get("https://example.com")
    expect(record?.mime).toBe("image/png")
    expect(new Uint8Array(record?.bytes as ArrayBuffer)).toEqual(
      new Uint8Array([1, 2, 3])
    )
  })

  it("returns null for a site it has never seen", async () => {
    const cache = makeCache()
    expect(await cache.get("https://example.com")).toBeNull()
  })

  it("stores a negative entry with no bytes", async () => {
    const cache = makeCache()
    await cache.putMiss("https://example.com")

    const record = await cache.get("https://example.com")
    expect(record).not.toBeNull()
    expect(record?.bytes).toBeUndefined()
  })
})

describe("FaviconCache expiry", () => {
  it("serves an icon right up to the TTL and not past it", async () => {
    const cache = makeCache()
    await cache.putIcon("https://example.com", bytes(1), "image/png")

    clock += FAVICON_TTL_MS - 1
    expect(await cache.get("https://example.com")).not.toBeNull()

    clock += 1
    expect(await cache.get("https://example.com")).toBeNull()
  })

  it("expires a negative entry far sooner than an icon", async () => {
    const cache = makeCache()
    await cache.putMiss("https://nothing.example")
    await cache.putIcon("https://example.com", bytes(1), "image/png")

    clock += FAVICON_MISS_TTL_MS
    expect(await cache.get("https://nothing.example")).toBeNull()
    // A site that once had no icon can get one; a site that had one keeps it.
    expect(await cache.get("https://example.com")).not.toBeNull()
  })
})

describe("FaviconCache object URLs", () => {
  it("creates one URL per site and reuses it", () => {
    const { factory, created } = trackingUrls()
    const cache = makeCache(factory)
    const record = {
      key: "https://example.com",
      storedAt: clock,
      bytes: bytes(1),
      mime: "image/png",
    }

    expect(cache.materialize(record)).toBe(cache.materialize(record))
    expect(created).toHaveLength(1)
  })

  it("hands out nothing for a negative record", () => {
    const { factory, created } = trackingUrls()
    const cache = makeCache(factory)

    expect(
      cache.materialize({ key: "https://a.example", storedAt: clock })
    ).toBe("")
    expect(created).toHaveLength(0)
  })

  it("revokes a site's URL when its record is replaced", async () => {
    const { factory, created, revoked } = trackingUrls()
    const cache = makeCache(factory)

    const first = await cache.putIcon(
      "https://a.example",
      bytes(1),
      "image/png"
    )
    const firstUrl = cache.materialize(first)
    const second = await cache.putIcon(
      "https://a.example",
      bytes(2),
      "image/png"
    )
    const secondUrl = cache.materialize(second)

    expect(revoked).toEqual([firstUrl])
    expect(secondUrl).not.toBe(firstUrl)
    expect(created).toHaveLength(2)
  })

  it("revokes a site's URL when the record turns negative", async () => {
    const { factory, revoked } = trackingUrls()
    const cache = makeCache(factory)

    const record = await cache.putIcon(
      "https://a.example",
      bytes(1),
      "image/png"
    )
    const url = cache.materialize(record)
    await cache.putMiss("https://a.example")

    expect(revoked).toEqual([url])
  })
})

describe("FaviconCache eviction", () => {
  it("trims the oldest entries once the ceiling is passed, and revokes their URLs", async () => {
    const { factory, revoked } = trackingUrls()
    const cache = makeCache(factory)

    for (let i = 0; i < FAVICON_MAX_ENTRIES; i += 1) {
      clock += 1
      const record = await cache.putIcon(
        `https://site-${i}.example`,
        bytes(i % 256),
        "image/png"
      )
      // Only the oldest entry is rendering, so only its URL should come back.
      if (i === 0) cache.materialize(record)
    }

    // Still full, nothing evicted: the ceiling has not been passed yet.
    expect(await cache.get("https://site-0.example")).not.toBeNull()
    expect(revoked).toHaveLength(0)

    clock += 1
    await cache.putIcon("https://one-too-many.example", bytes(9), "image/png")

    // The trim takes the cache down to FAVICON_TRIM_TO, oldest first.
    const evictedCount = FAVICON_MAX_ENTRIES + 1 - FAVICON_TRIM_TO
    expect(await cache.get("https://site-0.example")).toBeNull()
    expect(
      await cache.get(`https://site-${evictedCount - 1}.example`)
    ).toBeNull()
    expect(
      await cache.get(`https://site-${evictedCount}.example`)
    ).not.toBeNull()
    expect(await cache.get("https://one-too-many.example")).not.toBeNull()

    // The evicted site's live object URL went with it.
    expect(revoked).toHaveLength(1)
  })
})
