import { describe, expect, it } from "vitest"
import { DaemonFaviconAdapter, localFaviconDataUri } from "../favicon"

describe("localFaviconDataUri", () => {
  it("never returns a network-fetchable URL", () => {
    const uri = localFaviconDataUri("https://example.com/page")
    expect(uri.startsWith("data:image/svg+xml")).toBe(true)
    expect(uri).not.toMatch(/^https?:/)
  })

  it("is deterministic for the same URL", () => {
    const a = localFaviconDataUri("https://example.com/page")
    const b = localFaviconDataUri("https://example.com/other-page")
    expect(a).toBe(b)
  })

  it("differs across distinct hosts", () => {
    const a = localFaviconDataUri("https://example.com")
    const b = localFaviconDataUri("https://anotherhost.test")
    expect(a).not.toBe(b)
  })

  it("degrades gracefully for an unparsable URL instead of throwing", () => {
    expect(() => localFaviconDataUri("not a url")).not.toThrow()
  })
})

describe("DaemonFaviconAdapter", () => {
  it("reports itself as always available and returns a local data URI", () => {
    const adapter = new DaemonFaviconAdapter()
    expect(adapter.isAvailable()).toBe(true)
    expect(adapter.getUrl("https://example.com").startsWith("data:")).toBe(true)
  })
})
