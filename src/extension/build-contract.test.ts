// @vitest-environment node

import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import {
  BACKGROUND_OUTPUT_FILE,
  BACKGROUND_OUTPUT_FORMAT,
  buildEntryNames,
} from "./build-contract"

async function manifest(name: "chrome" | "firefox" | "safari") {
  return JSON.parse(
    await readFile(
      new URL(`../../manifests/manifest.${name}.json`, import.meta.url),
      "utf8"
    )
  ) as Record<string, unknown>
}

describe("extension build contract", () => {
  it("builds the new tab, popup, and stable background entries for extensions", () => {
    expect(buildEntryNames("chrome")).toEqual(["index", "popup", "background"])
    expect(buildEntryNames("firefox")).toEqual(["index", "popup", "background"])
    expect(buildEntryNames("safari")).toEqual(["index", "popup", "background"])
    expect(BACKGROUND_OUTPUT_FILE).toBe("background.js")
    expect(BACKGROUND_OUTPUT_FORMAT).toBe("iife")
  })

  it("keeps the daemon-served build free of extension-only entries", () => {
    expect(buildEntryNames("daemon")).toEqual(["index"])
  })

  it("wires each MV3 manifest to the popup, omnibox, and correct background form", async () => {
    const chrome = await manifest("chrome")
    const firefox = await manifest("firefox")

    expect(chrome.action).toMatchObject({ default_popup: "popup.html" })
    expect(chrome.background).toEqual({
      service_worker: BACKGROUND_OUTPUT_FILE,
      type: "module",
    })
    expect(firefox.action).toMatchObject({ default_popup: "popup.html" })
    expect(firefox.background).toEqual({ scripts: [BACKGROUND_OUTPUT_FILE] })
    expect(chrome.omnibox).toEqual({ keyword: "bb" })
    expect(firefox.omnibox).toEqual({ keyword: "bb" })
    expect(chrome.permissions).toContain("activeTab")
    expect(chrome.permissions).not.toContain("tabs")
    expect(firefox.permissions).toContain("activeTab")
    expect(firefox.permissions).not.toContain("clipboardWrite")
  })

  /**
   * Safari is daemon-only because its WebExtensions implementation has no
   * bookmarks API and no omnibox, and it allows no new-tab override. The
   * manifest is the contract: the capability is omitted, not guarded at
   * runtime by feature code.
   */
  it("the Safari manifest omits every capability Safari does not have", async () => {
    const safari = await manifest("safari")

    expect(safari.action).toMatchObject({ default_popup: "popup.html" })
    expect(safari.background).toEqual({
      service_worker: BACKGROUND_OUTPUT_FILE,
      type: "module",
    })
    expect(safari.permissions).not.toContain("bookmarks")
    // `tabs` would hand over the URL and title of every open tab, standing
    // where Safari already prompts per site. The capture popup reads only the
    // tab the user invoked it on, which is what `activeTab` grants — Chrome
    // and Firefox run the same code without `tabs`, so asking for it here
    // would buy nothing and widen the prompt.
    expect(safari.permissions).not.toContain("tabs")
    expect(safari.omnibox).toBeUndefined()
    expect(safari.chrome_url_overrides).toBeUndefined()
    expect(safari.chrome_settings_overrides).toBeUndefined()
    // Loopback daemon connections remain optional, requested on Connect.
    expect(safari.optional_host_permissions).toEqual([
      "http://127.0.0.1/*",
      "http://localhost/*",
    ])
  })
})
