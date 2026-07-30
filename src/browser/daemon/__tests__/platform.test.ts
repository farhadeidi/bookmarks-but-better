import { afterEach, describe, expect, it, vi } from "vitest"
import { isDaemonModeSupported } from "../platform"

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubUserAgent(userAgent: string) {
  vi.stubGlobal("navigator", { userAgent })
}

describe("isDaemonModeSupported", () => {
  it("is true for an ordinary desktop user agent", () => {
    stubUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
    )
    expect(isDaemonModeSupported()).toBe(true)
  })

  it("is true for desktop Firefox", () => {
    stubUserAgent(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.0; rv:120.0) Gecko/20100101 Firefox/120.0"
    )
    expect(isDaemonModeSupported()).toBe(true)
  })

  it("is false for Firefox on Android", () => {
    stubUserAgent(
      "Mozilla/5.0 (Android 14; Mobile; rv:120.0) Gecko/120.0 Firefox/120.0"
    )
    expect(isDaemonModeSupported()).toBe(false)
  })

  it("is false for an iOS user agent", () => {
    stubUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15"
    )
    expect(isDaemonModeSupported()).toBe(false)
  })

  it("defaults to true when navigator is unavailable", () => {
    vi.stubGlobal("navigator", undefined)
    expect(isDaemonModeSupported()).toBe(true)
  })
})
