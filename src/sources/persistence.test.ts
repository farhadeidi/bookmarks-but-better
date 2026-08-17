// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import {
  setAdapterModePreference,
  setDaemonConnectionConfig,
} from "@/browser/adapter-preference"
import { platformCapabilities } from "./platform"
import { daemonSourceId, LEGACY_VAULT_ID } from "./config"
import { loadSourceConfig, saveSourceConfig } from "./persistence"

installFakeIndexedDB()

beforeEach(() => {
  // A desktop extension context, so the Browser Source survives
  // normalization the way a real Chrome profile's does.
  vi.stubGlobal("chrome", { bookmarks: {}, storage: {} })
})

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

describe("loadSourceConfig", () => {
  it("migrates a v1 standalone profile once, marking it legacy for the sunset", async () => {
    await setAdapterModePreference("standalone")

    const config = await loadSourceConfig(platformCapabilities())

    expect(config.version).toBe(2)
    expect(config.sources.standalone).toEqual({ enabled: true, legacy: true })
    expect(config.activeSourceId).toBe("standalone")

    // And once: the stored v2 document wins over the stale v1 mode from
    // here on, even if the legacy key changes underneath it.
    await setAdapterModePreference("browser")
    const again = await loadSourceConfig(platformCapabilities())
    expect(again.activeSourceId).toBe("standalone")
  })

  it("migrates a v1 daemon profile with its connection, active and unfallbackable", async () => {
    await setAdapterModePreference("daemon")
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:47321" })

    const config = await loadSourceConfig(platformCapabilities())

    expect(config.connections["http://127.0.0.1:47321"]).toEqual({})
    expect(config.sources.browser?.enabled).toBe(true)
    const id = daemonSourceId("http://127.0.0.1:47321", LEGACY_VAULT_ID)
    expect(config.sources[id]).toMatchObject({
      enabled: true,
      origin: "http://127.0.0.1:47321",
      vaultId: LEGACY_VAULT_ID,
    })
    expect(config.activeSourceId).toBe(id)
  })

  it("migrates a v1 browser profile unchanged in behaviour", async () => {
    await setAdapterModePreference("browser")

    const config = await loadSourceConfig(platformCapabilities())
    expect(config.sources.browser).toEqual({ enabled: true })
    expect(config.activeSourceId).toBe("browser")
  })

  it("round-trips a saved v2 config", async () => {
    await saveSourceConfig({
      version: 2,
      connections: { "http://localhost:52223": { bearerToken: "t" } },
      sources: {
        browser: { enabled: false },
        [daemonSourceId("http://localhost:52223", "main")]: {
          enabled: true,
          origin: "http://localhost:52223",
          vaultId: "main",
          name: "Main",
        },
      },
      activeSourceId: daemonSourceId("http://localhost:52223", "main"),
    })

    const loaded = await loadSourceConfig(platformCapabilities())

    expect(loaded).toEqual({
      version: 2,
      connections: { "http://localhost:52223": { bearerToken: "t" } },
      sources: {
        // Browser survived disabled because another source is enabled; the
        // invariant is "at least one enabled", not "browser always on".
        browser: { enabled: false },
        [daemonSourceId("http://localhost:52223", "main")]: {
          enabled: true,
          origin: "http://localhost:52223",
          vaultId: "main",
          name: "Main",
        },
      },
      activeSourceId: daemonSourceId("http://localhost:52223", "main"),
    })
  })
})
