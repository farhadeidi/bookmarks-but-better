import { describe, it, expect } from "vitest"
import { isGoogleDefaultGlobe } from "./detect-default-globe"

const V2_URL =
  "https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https%3A%2F%2Fexample.com&size=64"

describe("isGoogleDefaultGlobe", () => {
  it("returns false for non-Google URLs even at 16x16", () => {
    expect(isGoogleDefaultGlobe("https://example.com/favicon.ico", 16, 16)).toBe(
      false
    )
  })

  it("returns false for empty URL", () => {
    expect(isGoogleDefaultGlobe("", 16, 16)).toBe(false)
  })

  it("returns true when Google favicon is 16x16", () => {
    expect(isGoogleDefaultGlobe(V2_URL, 16, 16)).toBe(true)
  })

  it("returns false when Google favicon is 32x32 (real favicon)", () => {
    expect(isGoogleDefaultGlobe(V2_URL, 32, 32)).toBe(false)
  })

  it("returns false when Google favicon is 64x64 (real favicon)", () => {
    expect(isGoogleDefaultGlobe(V2_URL, 64, 64)).toBe(false)
  })

  it("returns false for non-square 16 (unexpected shape)", () => {
    expect(isGoogleDefaultGlobe(V2_URL, 16, 24)).toBe(false)
  })

  it("returns true for s2 endpoint too", () => {
    expect(
      isGoogleDefaultGlobe(
        "https://www.google.com/s2/favicons?domain=example.com&sz=64",
        16,
        16
      )
    ).toBe(true)
  })
})
