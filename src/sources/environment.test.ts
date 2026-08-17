// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  devWorkbenchEnabled,
  productionSourceEnvironment,
  resolveSourceEnvironment,
  resetSourceEnvironment,
} from "./environment"

// The production environment is pure delegation: these are the modules whose
// behavior it forwards to, so they are the seams this suite controls.
vi.mock("@/sources/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/sources/adapters")>()
  return {
    ...actual,
    createAdapterForSource: vi.fn(),
  }
})

vi.mock("@/browser/daemon", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/browser/daemon")>()
  return {
    ...actual,
    connectToDaemon: vi.fn(),
    discoverDaemonVaults: vi.fn(),
    removeDaemonHostPermission: vi.fn().mockResolvedValue(undefined),
  }
})

const { createAdapterForSource } = await import("@/sources/adapters")
const { connectToDaemon, discoverDaemonVaults, removeDaemonHostPermission } =
  await import("@/browser/daemon")

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("VITE_BUILD_TARGET", "chrome")
  vi.stubGlobal("chrome", { bookmarks: {}, storage: {} })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  resetSourceEnvironment()
})

describe("the production environment", () => {
  it("answers capabilities from the platform seam", () => {
    expect(productionSourceEnvironment.capabilities().browserSource).toBe(true)
  })

  it("builds adapters through the source adapter factory", async () => {
    const sentinel = { caps: true } as never
    vi.mocked(createAdapterForSource).mockReturnValue(sentinel)
    const connections = { "http://127.0.0.1:52222": { bearerToken: "t" } }

    const built = await productionSourceEnvironment.adapterFor(
      {
        id: "browser",
        kind: "browser",
        label: "Browser bookmarks",
        defaultLabel: "Browser bookmarks",
      },
      connections
    )

    expect(built).toBe(sentinel)
    expect(createAdapterForSource).toHaveBeenCalledWith(
      {
        id: "browser",
        kind: "browser",
        label: "Browser bookmarks",
        defaultLabel: "Browser bookmarks",
      },
      connections
    )
  })

  it("connects through the daemon connect flow", async () => {
    const result = {
      ok: true as const,
      origin: "http://127.0.0.1:52222",
      warnings: [],
      vaults: [],
      legacyProtocol: false,
    }
    vi.mocked(connectToDaemon).mockResolvedValue(result)

    await expect(
      productionSourceEnvironment.connect("127.0.0.1:52222", {
        bearerToken: "t",
      })
    ).resolves.toBe(result)
    expect(connectToDaemon).toHaveBeenCalledWith("127.0.0.1:52222", {
      bearerToken: "t",
    })
  })

  it("discovers every reachable connection and skips unreachable ones", async () => {
    vi.mocked(discoverDaemonVaults)
      .mockResolvedValueOnce({
        vaults: [{ id: "reading", name: "Reading" }],
        legacyProtocol: false,
      })
      .mockRejectedValueOnce(new Error("unreachable"))

    const discoveries = await productionSourceEnvironment.refreshDiscoveries({
      "http://127.0.0.1:52222": {},
      "http://127.0.0.1:52223": {},
    })

    expect(discoveries).toEqual([
      {
        origin: "http://127.0.0.1:52222",
        vaults: [{ id: "reading", name: "Reading" }],
        legacyProtocol: false,
      },
    ])
  })

  it("discovers the same-origin daemon on the daemon-served build, and at startup", async () => {
    vi.stubEnv("VITE_BUILD_TARGET", "daemon")
    vi.mocked(discoverDaemonVaults).mockResolvedValue({
      vaults: [{ id: "main" }],
      legacyProtocol: false,
    })

    expect(productionSourceEnvironment.discoveryAtStartup).toBe(true)
    const discoveries = await productionSourceEnvironment.refreshDiscoveries({})
    expect(discoveries).toEqual([
      { origin: "", vaults: [{ id: "main" }], legacyProtocol: false },
    ])
  })

  it("does not fold startup discovery in on extension builds", () => {
    expect(productionSourceEnvironment.discoveryAtStartup).toBe(false)
  })

  it("releases daemon access when the environment is asked to", async () => {
    await productionSourceEnvironment.releaseDaemonAccess()
    expect(removeDaemonHostPermission).toHaveBeenCalledTimes(1)
  })
})

describe("environment resolution", () => {
  it("resolves to the production environment in a test run", async () => {
    expect(devWorkbenchEnabled()).toBe(false)
    await expect(resolveSourceEnvironment()).resolves.toBe(
      productionSourceEnvironment
    )
  })

  it("memoizes the resolved environment", async () => {
    await expect(resolveSourceEnvironment()).resolves.toBe(
      await resolveSourceEnvironment()
    )
  })
})
