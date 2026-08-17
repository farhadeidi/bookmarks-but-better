// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { platformCapabilities } from "./platform"

/**
 * The capability seam is what feature code consumes instead of browser
 * names. `VITE_BUILD_TARGET` decides the build half; the presence of the
 * extension APIs decides the runtime half.
 */
describe("platformCapabilities", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("chrome build with extension APIs: everything a full extension has", () => {
    vi.stubEnv("VITE_BUILD_TARGET", "chrome")
    vi.stubGlobal("chrome", {
      bookmarks: {},
      storage: {},
      omnibox: {},
    })

    const caps = platformCapabilities()
    expect(caps.buildTarget).toBe("chrome")
    expect(caps.browserSource).toBe(true)
    expect(caps.omnibox).toBe(true)
    expect(caps.isExtension).toBe(true)
    expect(caps.daemonSource).toBe(true)
  })

  it("safari build: no Browser Source, no omnibox, but daemon sources and extension context", () => {
    vi.stubEnv("VITE_BUILD_TARGET", "safari")
    // Safari's WebExtensions implementation has runtime and storage but no
    // bookmarks API and no omnibox.
    vi.stubGlobal("chrome", {
      storage: {},
      runtime: { id: "safari-extension" },
    })

    const caps = platformCapabilities()
    expect(caps.buildTarget).toBe("safari")
    expect(caps.browserSource).toBe(false)
    expect(caps.omnibox).toBe(false)
    expect(caps.isExtension).toBe(true)
    expect(caps.daemonSource).toBe(true)
  })

  it("daemon-served build: a client of a daemon, not an extension", () => {
    vi.stubEnv("VITE_BUILD_TARGET", "daemon")

    const caps = platformCapabilities()
    expect(caps.buildTarget).toBe("daemon")
    expect(caps.browserSource).toBe(false)
    expect(caps.omnibox).toBe(false)
    expect(caps.isExtension).toBe(false)
    expect(caps.daemonSource).toBe(true)
  })

  it("an extension build running outside a browser omits what does not exist", () => {
    vi.stubEnv("VITE_BUILD_TARGET", "chrome")

    const caps = platformCapabilities()
    expect(caps.browserSource).toBe(false)
    expect(caps.omnibox).toBe(false)
    expect(caps.isExtension).toBe(false)
  })

  it("an unknown target is not a claim of Safari or daemon: it reads as chrome", () => {
    vi.stubEnv("VITE_BUILD_TARGET", "edge-pro-max")
    expect(platformCapabilities().buildTarget).toBe("chrome")
  })
})
