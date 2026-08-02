// @vitest-environment node

import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import {
  BACKGROUND_OUTPUT_FILE,
  BACKGROUND_OUTPUT_FORMAT,
  buildEntryNames,
} from "./build-contract"

async function manifest(name: "chrome" | "firefox") {
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
    expect(chrome.omnibox).toEqual({ keyword: "bbb" })
    expect(firefox.omnibox).toEqual({ keyword: "bbb" })
    expect(chrome.permissions).toContain("activeTab")
    expect(chrome.permissions).not.toContain("tabs")
    expect(firefox.permissions).toContain("activeTab")
    expect(firefox.permissions).not.toContain("clipboardWrite")
  })
})
