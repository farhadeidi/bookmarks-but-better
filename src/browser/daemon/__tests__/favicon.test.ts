import { afterEach, describe, expect, it, vi } from "vitest"
import { DaemonFaviconAdapter } from "../favicon"
import { StandaloneFaviconAdapter } from "../../standalone/favicon"
import { FirefoxFaviconAdapter } from "../../firefox/favicon"
import { ChromeFaviconAdapter } from "../../chrome/favicon"

const adapter = new DaemonFaviconAdapter()

describe("DaemonFaviconAdapter", () => {
  it("is always available", () => {
    expect(adapter.isAvailable()).toBe(true)
  })

  it("resolves a real favicon through Google's V2 service", () => {
    const url = adapter.getUrl("https://example.com/some/deep/page?q=1")

    expect(url).toContain("https://t1.gstatic.com/faviconV2")
    // The origin is sent, never the full path — a bookmark's path can carry a
    // share token or a private document id, and none of that belongs in a
    // third-party request.
    expect(url).toContain(encodeURIComponent("https://example.com"))
    expect(url).not.toContain("deep")
    expect(url).not.toContain("q%3D1")
  })

  it("falls back to the s2 favicon service", () => {
    const url = adapter.getFallbackUrl("https://example.com/page")

    expect(url).toContain("https://www.google.com/s2/favicons")
    expect(url).toContain("domain=example.com")
  })

  it("no longer returns a local data: URI", () => {
    // Regression guard for the change itself: daemon mode used to answer with a
    // generated letter-avatar SVG, which is what made every seeded bookmark
    // render as a placeholder.
    expect(adapter.getUrl("https://example.com")).not.toMatch(/^data:/)
  })

  it("degrades to an empty string for an unparsable URL instead of throwing", () => {
    expect(() => adapter.getUrl("not a url")).not.toThrow()
    expect(() => adapter.getFallbackUrl("not a url")).not.toThrow()
    expect(adapter.getUrl("not a url")).toBe("")
    expect(adapter.getFallbackUrl("not a url")).toBe("")
  })
})

describe("daemon favicon privacy trade-off", () => {
  // This suite replaces an earlier one that asserted the daemon "never returns
  // a network-fetchable URL". That guarantee was given up on purpose so real
  // icons load. These tests state what is disclosed now, so the trade-off stays
  // visible and cannot be widened silently.
  it("discloses the bookmarked origin to a third party", () => {
    const url = adapter.getUrl("https://private-intranet.example/page")

    expect(url).toMatch(/^https:\/\//)
    expect(new URL(url).hostname).toBe("t1.gstatic.com")
    expect(url).toContain(
      encodeURIComponent("https://private-intranet.example")
    )
  })

  it("discloses to Google and to nobody else", () => {
    const hosts = [
      adapter.getUrl("https://example.com"),
      adapter.getFallbackUrl("https://example.com"),
    ].map((url) => new URL(url).hostname)

    expect(hosts).toEqual(["t1.gstatic.com", "www.google.com"])
  })

  it("matches standalone mode exactly, so there is one behaviour to reason about", () => {
    const standalone = new StandaloneFaviconAdapter()
    const pageUrl = "https://example.com/page"

    expect(adapter.getUrl(pageUrl)).toBe(standalone.getUrl(pageUrl))
    expect(adapter.getFallbackUrl(pageUrl)).toBe(
      standalone.getFallbackUrl(pageUrl)
    )
  })
})

describe("provider matrix", () => {
  // Pins the claim the README and CHANGELOG make. The docs previously said
  // daemon mode behaved "exactly as the browser-extension and standalone builds
  // do", which is true only of the primary provider — the fallbacks diverge, and
  // that divergence is the whole point of the privacy note. No test caught the
  // overstatement, so these do.
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const pageUrl = "https://example.com/page"

  it("shares the primary Google V2 provider everywhere there is no native one", () => {
    const primaries = [
      adapter.getUrl(pageUrl),
      new StandaloneFaviconAdapter().getUrl(pageUrl),
      new FirefoxFaviconAdapter().getUrl(pageUrl),
    ]

    expect(new Set(primaries).size).toBe(1)
    expect(primaries[0]).toContain("https://t1.gstatic.com/faviconV2")
  })

  it("does not share the primary: Chrome asks itself before it asks Google", () => {
    vi.stubGlobal("chrome", { runtime: { id: "abcdef" } })

    const chromePrimary = new ChromeFaviconAdapter().getUrl(pageUrl)

    expect(chromePrimary.startsWith("chrome-extension://")).toBe(true)
    expect(chromePrimary).not.toBe(adapter.getUrl(pageUrl))
  })

  it("does not share the fallback: daemon's second try is still Google", () => {
    vi.stubGlobal("chrome", { runtime: { id: "abcdef" } })

    const daemonFallback = adapter.getFallbackUrl(pageUrl)
    const chromeFallback = new ChromeFaviconAdapter().getFallbackUrl(pageUrl)

    expect(new URL(daemonFallback).hostname).toBe("www.google.com")
    // Chrome's second try is Google's V2 service, the one its first try —
    // the browser's own icon database — could not answer for.
    expect(new URL(chromeFallback).hostname).toBe("t1.gstatic.com")
  })

  it("does not share the fallback: Firefox makes no second attempt at all", () => {
    const firefox = new FirefoxFaviconAdapter() as FirefoxFaviconAdapter & {
      getFallbackUrl?: (pageUrl: string) => string
    }

    expect(firefox.getFallbackUrl).toBeUndefined()
    expect(adapter.getFallbackUrl(pageUrl)).not.toBe("")
  })
})

describe("extension favicon providers", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("Firefox still has Google V2 as its only provider", () => {
    const firefox = new FirefoxFaviconAdapter()

    expect(firefox.getUrl("https://example.com")).toContain(
      "https://t1.gstatic.com/faviconV2"
    )
    // Documented in the adapter: Firefox has no `_favicon` equivalent, and the
    // native source it does have needs the `tabs` permission this extension
    // deliberately does not request. So there is still no second attempt.
    expect(
      (firefox as FirefoxFaviconAdapter & { getFallbackUrl?: unknown })
        .getFallbackUrl
    ).toBeUndefined()
  })

  it("Chrome asks its own _favicon API first and Google only after", () => {
    vi.stubGlobal("chrome", { runtime: { id: "abcdef" } })
    const chromeAdapter = new ChromeFaviconAdapter()

    expect(chromeAdapter.getUrl("https://example.com")).toBe(
      `chrome-extension://abcdef/_favicon/?pageUrl=${encodeURIComponent("https://example.com")}&size=64`
    )
    expect(chromeAdapter.getFallbackUrl("https://example.com")).toContain(
      "https://t1.gstatic.com/faviconV2"
    )
  })

  it("Chrome offers a way to recognize its own placeholder", () => {
    vi.stubGlobal("chrome", { runtime: { id: "abcdef" } })

    // Without this the cache could not store `_favicon` results at all: its
    // miss is a valid image, so a site Chrome knows nothing about would be
    // pinned to a generic icon instead of falling through to Google.
    expect(new ChromeFaviconAdapter().getPlaceholderProbeUrl()).toBe(
      `chrome-extension://abcdef/_favicon/?pageUrl=${encodeURIComponent("https://favicon-probe.invalid/")}&size=64`
    )
  })

  it("Chrome falls back to Google as its primary when _favicon is unavailable", () => {
    // A Chrome build loaded unprivileged — the dev server — has no
    // `chrome.runtime`, so there is nothing on-device to ask.
    const chromeAdapter = new ChromeFaviconAdapter()

    expect(chromeAdapter.getUrl("https://example.com")).toContain(
      "https://t1.gstatic.com/faviconV2"
    )
    expect(chromeAdapter.getPlaceholderProbeUrl()).toBe("")
  })
})
