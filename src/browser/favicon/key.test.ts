import { describe, expect, it } from "vitest"
import { normalizeFaviconKey } from "./key"

describe("normalizeFaviconKey", () => {
  it("keeps scheme and host and drops everything below the site", () => {
    expect(normalizeFaviconKey("https://example.com/deep/page?q=1#x")).toBe(
      "https://example.com"
    )
  })

  it("gives every page on one site the same key", () => {
    expect(normalizeFaviconKey("https://example.com/a")).toBe(
      normalizeFaviconKey("https://example.com/b")
    )
  })

  it("lowercases the host", () => {
    expect(normalizeFaviconKey("https://EXAMPLE.com")).toBe(
      "https://example.com"
    )
  })

  it("keys an IDN by its Punycode form, so both spellings share an entry", () => {
    expect(normalizeFaviconKey("https://bücher.example")).toBe(
      "https://xn--bcher-kva.example"
    )
    expect(normalizeFaviconKey("https://xn--bcher-kva.example/page")).toBe(
      "https://xn--bcher-kva.example"
    )
  })

  it("strips the fully-qualified trailing dot", () => {
    expect(normalizeFaviconKey("https://example.com./page")).toBe(
      "https://example.com"
    )
  })

  it("drops a default port but keeps a non-default one", () => {
    expect(normalizeFaviconKey("https://example.com:443/")).toBe(
      "https://example.com"
    )
    expect(normalizeFaviconKey("http://example.com:80/")).toBe(
      "http://example.com"
    )
    expect(normalizeFaviconKey("http://localhost:3000/")).toBe(
      "http://localhost:3000"
    )
  })

  it("separates ports, which can serve different icons", () => {
    expect(normalizeFaviconKey("http://localhost:3000/")).not.toBe(
      normalizeFaviconKey("http://localhost:8080/")
    )
  })

  it("separates schemes, which are different origins", () => {
    expect(normalizeFaviconKey("http://example.com")).not.toBe(
      normalizeFaviconKey("https://example.com")
    )
  })

  it("ignores credentials in the URL", () => {
    expect(normalizeFaviconKey("https://user:pw@example.com/x")).toBe(
      "https://example.com"
    )
  })

  it("refuses anything no provider could answer for", () => {
    expect(normalizeFaviconKey("not a url")).toBeNull()
    expect(normalizeFaviconKey("")).toBeNull()
    expect(normalizeFaviconKey("file:///Users/me/private.html")).toBeNull()
    expect(normalizeFaviconKey("about:blank")).toBeNull()
    expect(normalizeFaviconKey("javascript:void 0")).toBeNull()
    expect(normalizeFaviconKey("chrome://bookmarks")).toBeNull()
  })
})
