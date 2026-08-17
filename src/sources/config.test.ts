// @vitest-environment node

import { describe, expect, it } from "vitest"
import {
  BROWSER_SOURCE_ID,
  LEGACY_VAULT_ID,
  STANDALONE_REMOVAL_MAJOR_VERSION,
  STANDALONE_SOURCE_ID,
  daemonSourceId,
  disableSource,
  enableSource,
  enabledSourceIds,
  forgetDaemonConnection,
  migrateFromAdapterMode,
  normalizeSourceConfig,
  parseDaemonSourceId,
  removeSource,
  setActiveSource,
  upsertDaemonSource,
  type SourceConfig,
} from "./config"
import type { PlatformCapabilities } from "./platform"

const extensionCaps: PlatformCapabilities = {
  buildTarget: "chrome",
  browserSource: true,
  omnibox: true,
  isExtension: true,
  daemonSource: true,
}

const safariCaps: PlatformCapabilities = {
  buildTarget: "safari",
  browserSource: false,
  omnibox: false,
  isExtension: true,
  daemonSource: true,
}

const servedCaps: PlatformCapabilities = {
  buildTarget: "daemon",
  browserSource: false,
  omnibox: false,
  isExtension: false,
  daemonSource: true,
}

function normalized(config: SourceConfig, caps = extensionCaps): SourceConfig {
  return normalizeSourceConfig(config, caps)
}

describe("daemon source ids", () => {
  it("round-trips origin and vault id", () => {
    const id = daemonSourceId("http://127.0.0.1:52222", "reading-list")
    expect(parseDaemonSourceId(id)).toEqual({
      origin: "http://127.0.0.1:52222",
      vaultId: "reading-list",
    })
  })

  it("round-trips the served app's empty origin", () => {
    const id = daemonSourceId("", "main")
    expect(parseDaemonSourceId(id)).toEqual({ origin: "", vaultId: "main" })
  })

  it("refuses ids that are not daemon sources", () => {
    expect(parseDaemonSourceId("browser")).toBeNull()
    expect(parseDaemonSourceId("daemon:no-separator")).toBeNull()
    expect(parseDaemonSourceId("daemon:origin#")).toBeNull()
  })
})

describe("migration from adapterMode", () => {
  it("a browser profile keeps browser enabled and active", () => {
    const config = normalized(
      migrateFromAdapterMode(
        { adapterMode: "browser", daemonConnection: null },
        extensionCaps
      )
    )

    expect(config.sources[BROWSER_SOURCE_ID]?.enabled).toBe(true)
    expect(config.activeSourceId).toBe(BROWSER_SOURCE_ID)
    expect(Object.keys(config.sources)).toHaveLength(1)
  })

  it("a fresh profile (no stored mode) starts on browser", () => {
    const config = normalized(
      migrateFromAdapterMode(
        { adapterMode: null, daemonConnection: null },
        extensionCaps
      )
    )
    expect(config.activeSourceId).toBe(BROWSER_SOURCE_ID)
  })

  it("a standalone profile is marked legacy and stays active through the sunset", () => {
    const config = normalized(
      migrateFromAdapterMode(
        { adapterMode: "standalone", daemonConnection: null },
        extensionCaps
      )
    )

    expect(config.sources[STANDALONE_SOURCE_ID]).toEqual({
      enabled: true,
      legacy: true,
    })
    expect(config.activeSourceId).toBe(STANDALONE_SOURCE_ID)
    expect(STANDALONE_REMOVAL_MAJOR_VERSION).toBeGreaterThan(4)
  })

  it("a daemon profile keeps the daemon active with browser still enabled, and never silently falls back", () => {
    const origin = "http://127.0.0.1:47321"
    const config = normalized(
      migrateFromAdapterMode(
        { adapterMode: "daemon", daemonConnection: { origin } },
        extensionCaps
      )
    )

    expect(config.connections[origin]).toEqual({})
    expect(config.sources[BROWSER_SOURCE_ID]?.enabled).toBe(true)

    const daemonId = daemonSourceId(origin, LEGACY_VAULT_ID)
    expect(config.sources[daemonId]).toMatchObject({
      enabled: true,
      origin,
      vaultId: LEGACY_VAULT_ID,
    })
    // The unreachable daemon stays selected: the failure must surface against
    // the source the user chose, not become a switch to browser bookmarks.
    expect(config.activeSourceId).toBe(daemonId)
  })

  it("a safari profile starts with no source at all", () => {
    const config = normalized(
      migrateFromAdapterMode(
        { adapterMode: "browser", daemonConnection: null },
        safariCaps
      )
    )
    expect(config.sources).toEqual({})
    expect(config.activeSourceId).toBeNull()
  })
})

describe("the standalone sunset rules", () => {
  it("a standalone entry without the legacy flag is removed entirely", () => {
    const config = normalized({
      version: 2,
      connections: {},
      sources: {
        [BROWSER_SOURCE_ID]: { enabled: true },
        [STANDALONE_SOURCE_ID]: { enabled: true },
      },
      activeSourceId: STANDALONE_SOURCE_ID,
    })

    expect(config.sources[STANDALONE_SOURCE_ID]).toBeUndefined()
    // Active falls back deterministically rather than dangling.
    expect(config.activeSourceId).toBe(BROWSER_SOURCE_ID)
  })

  it("the served app has no standalone source even if a config claims one", () => {
    const config = normalized(
      {
        version: 2,
        connections: {},
        sources: {
          [STANDALONE_SOURCE_ID]: { enabled: true, legacy: true },
        },
        activeSourceId: STANDALONE_SOURCE_ID,
      },
      servedCaps
    )
    expect(config.sources[STANDALONE_SOURCE_ID]).toBeUndefined()
    expect(config.activeSourceId).toBeNull()
  })
})

describe("enabled/active invariants", () => {
  it("refuses to disable the last enabled source", () => {
    const config = normalized({
      version: 2,
      connections: {},
      sources: { [BROWSER_SOURCE_ID]: { enabled: true } },
      activeSourceId: BROWSER_SOURCE_ID,
    })

    expect(disableSource(config, BROWSER_SOURCE_ID)).toBeNull()
  })

  it("disabling the active source moves active to the next enabled one, retaining configuration", () => {
    const origin = "http://127.0.0.1:52222"
    let config = normalized({
      version: 2,
      connections: { [origin]: {} },
      sources: {
        [BROWSER_SOURCE_ID]: { enabled: true },
        [daemonSourceId(origin, "main")]: {
          enabled: true,
          origin,
          vaultId: "main",
        },
      },
      activeSourceId: daemonSourceId(origin, "main"),
    })

    config = disableSource(config, daemonSourceId(origin, "main"))!

    expect(config.sources[daemonSourceId(origin, "main")]?.enabled).toBe(false)
    expect(config.activeSourceId).toBe(BROWSER_SOURCE_ID)
    // Disabling retained the connection and the source's configuration.
    expect(config.connections[origin]).toBeDefined()
    expect(config.sources[daemonSourceId(origin, "main")]?.origin).toBe(origin)
  })

  it("re-enabling a source never steals active", () => {
    let config = normalized({
      version: 2,
      connections: {},
      sources: {
        [BROWSER_SOURCE_ID]: { enabled: true },
        [STANDALONE_SOURCE_ID]: { enabled: false, legacy: true },
      },
      activeSourceId: BROWSER_SOURCE_ID,
    })

    config = enableSource(config, STANDALONE_SOURCE_ID)

    expect(config.sources[STANDALONE_SOURCE_ID]?.enabled).toBe(true)
    expect(config.activeSourceId).toBe(BROWSER_SOURCE_ID)
  })

  it("the active source must be enabled", () => {
    const config = normalized({
      version: 2,
      connections: {},
      sources: {
        [BROWSER_SOURCE_ID]: { enabled: true },
        [STANDALONE_SOURCE_ID]: { enabled: false, legacy: true },
      },
      activeSourceId: STANDALONE_SOURCE_ID,
    })

    // Normalization already repaired the dangling active selection.
    expect(config.activeSourceId).toBe(BROWSER_SOURCE_ID)
    expect(
      setActiveSource(
        {
          ...config,
          sources: {
            ...config.sources,
            [STANDALONE_SOURCE_ID]: { enabled: false, legacy: true },
          },
        },
        STANDALONE_SOURCE_ID
      )
    ).toBeNull()
  })

  it("forgetting a daemon connection is separate from disabling and removes its sources", () => {
    const origin = "http://127.0.0.1:52222"
    const other = "http://localhost:52223"
    const config = forgetDaemonConnection(
      normalized({
        version: 2,
        connections: {
          [origin]: { bearerToken: "t" },
          [other]: {},
        },
        sources: {
          [BROWSER_SOURCE_ID]: { enabled: true },
          [daemonSourceId(origin, "main")]: {
            enabled: true,
            origin,
            vaultId: "main",
          },
          [daemonSourceId(other, "aux")]: {
            enabled: true,
            origin: other,
            vaultId: "aux",
          },
        },
        activeSourceId: daemonSourceId(origin, "main"),
      }),
      origin
    )

    expect(config.connections[origin]).toBeUndefined()
    expect(config.connections[other]).toBeDefined()
    expect(config.sources[daemonSourceId(origin, "main")]).toBeUndefined()
    expect(config.sources[daemonSourceId(other, "aux")]).toBeDefined()
    expect(config.activeSourceId).toBe(BROWSER_SOURCE_ID)
  })

  it("removing one vault source keeps its connection and siblings", () => {
    const origin = "http://127.0.0.1:52222"
    const gone = daemonSourceId(origin, "gone")
    const kept = daemonSourceId(origin, "kept")
    const config = removeSource(
      normalized({
        version: 2,
        connections: { [origin]: {} },
        sources: {
          [gone]: { enabled: true, origin, vaultId: "gone" },
          [kept]: { enabled: true, origin, vaultId: "kept" },
        },
        activeSourceId: gone,
      }),
      gone
    )

    expect(config.connections[origin]).toBeDefined()
    expect(config.sources[gone]).toBeUndefined()
    expect(config.sources[kept]?.enabled).toBe(true)
    expect(config.activeSourceId).toBe(kept)
  })
})

describe("discovery upserts", () => {
  it("preserves enabled state across refreshes and records names", () => {
    const origin = "http://127.0.0.1:52222"
    const id = daemonSourceId(origin, "main")
    let config = upsertDaemonSource(
      normalized({
        version: 2,
        connections: {},
        sources: {},
        activeSourceId: null,
      }),
      origin,
      { id: "main" },
      { enabled: false }
    )

    expect(config.sources[id]?.enabled).toBe(false)

    config = upsertDaemonSource(config, origin, {
      id: "main",
      name: "Reading list",
    })
    expect(config.sources[id]?.enabled).toBe(false)
    expect(config.sources[id]?.name).toBe("Reading list")
  })

  it("lists enabled sources in a deterministic order: browser, standalone, daemon", () => {
    const origin = "http://127.0.0.1:52222"
    const config = normalized({
      version: 2,
      connections: { [origin]: {} },
      sources: {
        [daemonSourceId(origin, "zeta")]: {
          enabled: true,
          origin,
          vaultId: "zeta",
        },
        [STANDALONE_SOURCE_ID]: { enabled: true, legacy: true },
        [daemonSourceId(origin, "alpha")]: {
          enabled: true,
          origin,
          vaultId: "alpha",
        },
        [BROWSER_SOURCE_ID]: { enabled: true },
      },
      activeSourceId: BROWSER_SOURCE_ID,
    })

    expect(enabledSourceIds(config)).toEqual([
      BROWSER_SOURCE_ID,
      STANDALONE_SOURCE_ID,
      daemonSourceId(origin, "alpha"),
      daemonSourceId(origin, "zeta"),
    ])
  })
})

describe("platform normalization", () => {
  it("a safari config cannot hold a browser source, whatever it claims", () => {
    const config = normalized(
      {
        version: 2,
        connections: {},
        sources: { [BROWSER_SOURCE_ID]: { enabled: true } },
        activeSourceId: BROWSER_SOURCE_ID,
      },
      safariCaps
    )
    expect(config.sources[BROWSER_SOURCE_ID]).toBeUndefined()
    expect(config.activeSourceId).toBeNull()
  })
})

describe("legacy-protocol daemon connections", () => {
  it("a migrated daemon entry starts unscoped, and discovery upgrades it", () => {
    const origin = "http://127.0.0.1:47321"
    const config = normalized(
      migrateFromAdapterMode(
        { adapterMode: "daemon", daemonConnection: { origin } },
        extensionCaps
      )
    )

    const id = daemonSourceId(origin, LEGACY_VAULT_ID)
    expect(config.sources[id]?.unscoped).toBe(true)

    // Discovery against a vault-aware daemon clears the flag and records the
    // name; the id survives, so enabled state carries over.
    const upgraded = upsertDaemonSource(
      config,
      origin,
      { id: LEGACY_VAULT_ID, name: "Main" },
      { unscoped: false }
    )
    // Cleared reads as absent: the flag only exists while it is true.
    expect(upgraded.sources[id]?.unscoped).toBeUndefined()
    expect(upgraded.sources[id]?.name).toBe("Main")

    // And a legacy-protocol discovery keeps it.
    const stillLegacy = upsertDaemonSource(
      config,
      origin,
      { id: LEGACY_VAULT_ID },
      { unscoped: true }
    )
    expect(stillLegacy.sources[id]?.unscoped).toBe(true)
  })
})
