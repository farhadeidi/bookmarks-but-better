// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { loadSourceConfig } from "@/sources/persistence"
import {
  platformCapabilities,
  setPlatformCapabilities,
} from "@/sources/platform"
import { getOnboardingCompleted } from "@/browser/onboarding-preference"
import { daemonSourceId } from "@/sources/config"
import {
  devGet,
  SOURCES_STORE,
  writeAppliedStamp,
  type AppliedScenarioStamp,
} from "./state"
import { materializeSeed } from "./engine"
import {
  ensureDevRuntime,
  engineFor,
  resetDevRuntime,
  resetScenario,
  setFaults,
  subscribeRuntime,
  runtimeSnapshot,
} from "./runtime"

installFakeIndexedDB()

const ORIGIN = "http://127.0.0.1:52222"

beforeEach(() => {
  vi.clearAllMocks()
  // A fresh in-memory IndexedDB per test: shares nothing with the previous
  // one, so no database deletion (and no blocked-delete hangs) are needed.
  installFakeIndexedDB()
  // jsdom cannot navigate; the runtime's reset reloads via location.assign,
  // which tests intercept.
  vi.stubGlobal("location", {
    search: "",
    assign: vi.fn(),
  })
  resetDevRuntime()
})

afterEach(() => {
  resetDevRuntime()
  vi.unstubAllGlobals()
})

describe("first bootstrap", () => {
  it("seeds the default scenario into the profile's real stores", async () => {
    const runtime = await ensureDevRuntime()

    expect(runtime.state.scenarioId).toBe("browser-daemon")
    expect(runtime.state.revision).toBe(1)

    // The Source Configuration the app itself will read, seeded exactly as
    // the scenario defines it.
    const config = await loadSourceConfig(platformCapabilities())
    expect(config.sources.browser).toEqual({ enabled: true })
    expect(config.sources[daemonSourceId(ORIGIN, "reading")]).toMatchObject({
      enabled: true,
    })
    expect(config.activeSourceId).toBe("browser")

    expect(await getOnboardingCompleted()).toBe(true)
  })

  it("installs the scenario's capabilities as the platform's answer", async () => {
    // A plain dev page has no chrome.* APIs at all; the scenario is what
    // makes a Browser Source exist here.
    expect(platformCapabilities().browserSource).toBe(false)
    await ensureDevRuntime()
    expect(platformCapabilities().browserSource).toBe(true)
    expect(platformCapabilities().buildTarget).toBe("chrome")
  })

  it("is idempotent: a second bootstrap does not reseed or bump", async () => {
    await ensureDevRuntime()
    const config1 = await loadSourceConfig(platformCapabilities())

    resetDevRuntime()
    setPlatformCapabilities(getScenarioCaps())
    const runtime = await ensureDevRuntime()

    expect(runtime.state.revision).toBe(1)
    const config2 = await loadSourceConfig(platformCapabilities())
    expect(config2).toEqual(config1)
  })
})

describe("URL-addressed scenarios", () => {
  it("?scenario=safari wins over a persisted different scenario", async () => {
    await ensureDevRuntime() // default: browser-daemon

    resetDevRuntime()
    setPlatformCapabilities(null)
    vi.stubGlobal("location", {
      search: "?scenario=safari",
      assign: vi.fn(),
    })
    const runtime = await ensureDevRuntime()

    expect(runtime.state.scenarioId).toBe("safari")
    expect(platformCapabilities().browserSource).toBe(false)

    const config = await loadSourceConfig(platformCapabilities())
    expect(config.sources.browser).toBeUndefined()
    expect(config.activeSourceId).toBe(daemonSourceId(ORIGIN, "reading"))
  })

  it("an unknown scenario id falls back to the default", async () => {
    vi.stubGlobal("location", {
      search: "?scenario=not-a-scenario",
      assign: vi.fn(),
    })
    const runtime = await ensureDevRuntime()
    expect(runtime.state.scenarioId).toBe("browser-daemon")
  })
})

describe("persisted scenario state", () => {
  it("keeps the chosen scenario and faults across reloads", async () => {
    await ensureDevRuntime()
    await setFaults({ daemonOnline: false, daemonLatencyMs: 300 })

    resetDevRuntime()
    setPlatformCapabilities(null)
    const runtime = await ensureDevRuntime()

    expect(runtime.state.faults).toMatchObject({
      daemonOnline: false,
      daemonLatencyMs: 300,
    })
  })

  it("fault updates notify subscribers and never touch source data", async () => {
    await ensureDevRuntime()
    const listener = vi.fn()
    subscribeRuntime(listener)

    await setFaults({ mutationFailure: true })

    expect(listener).toHaveBeenCalled()
    expect(runtimeSnapshot().faults.mutationFailure).toBe(true)
    expect(await devGet(SOURCES_STORE, "tree:browser")).toBeNull()
  })

  it("reseeds profiles whose applied stamp predates the current seed schema", async () => {
    await ensureDevRuntime()
    const engine = await engineFor("browser", "browser", () =>
      materializeSeed(
        "0",
        "",
        "b",
        [],
        [
          { id: "1", title: "Bookmarks Bar", children: [] },
          { id: "2", title: "Other bookmarks", children: [] },
        ]
      )
    )
    await engine.create({ parentId: "1", title: "Legacy dev seed" })
    expect(await devGet(SOURCES_STORE, "tree:browser")).not.toBeNull()

    // Simulate the stamp written by a Workbench build before seed schemas
    // existed. A matching scenario/revision must not preserve its stale tree.
    await writeAppliedStamp({
      scenarioId: "browser-daemon",
      revision: 1,
    } as AppliedScenarioStamp)
    resetDevRuntime()
    setPlatformCapabilities(getScenarioCaps())

    await ensureDevRuntime()
    expect(await devGet(SOURCES_STORE, "tree:browser")).toBeNull()
  })
})

describe("Reset Scenario", () => {
  it("reseeds deterministically: mutations are gone, faults revert, and it reloads into the scenario URL", async () => {
    await ensureDevRuntime()
    const engine = await engineFor("browser", "browser", () =>
      materializeSeed(
        "0",
        "",
        "b",
        [],
        [
          { id: "1", title: "Bookmarks Bar", children: [] },
          { id: "2", title: "Other bookmarks", children: [] },
        ]
      )
    )
    await engine.create({ parentId: "1", title: "Mutation to forget" })
    await setFaults({ daemonOnline: false })
    expect(await devGet(SOURCES_STORE, "tree:browser")).not.toBeNull()

    await resetScenario()

    expect(window.location.assign).toHaveBeenCalledWith(
      "/?scenario=browser-daemon"
    )
    // The simulated data is wiped; the next hydration re-seeds.
    expect(await devGet(SOURCES_STORE, "tree:browser")).toBeNull()
    // The stamp matches the new revision, so a reload bootstraps without
    // reseeding again — and the runtime reflects the fresh world.
    resetDevRuntime()
    setPlatformCapabilities(getScenarioCaps())
    const next = await ensureDevRuntime()
    expect(next.state.revision).toBe(2)
    expect(next.state.faults.daemonOnline).toBe(true)
    const config = await loadSourceConfig(platformCapabilities())
    expect(config.activeSourceId).toBe("browser")
  })

  it("an engine write settling after the reset's wipe cannot resurrect the pre-reset tree", async () => {
    await ensureDevRuntime()
    const seed = () =>
      materializeSeed(
        "0",
        "",
        "b",
        [],
        [
          { id: "1", title: "Bookmarks Bar", children: [] },
          { id: "2", title: "Other bookmarks", children: [] },
        ]
      )
    const engine = await engineFor("browser", "browser", seed)
    await engine.create({ parentId: "1", title: "Before reset" })
    expect(await devGet(SOURCES_STORE, "tree:browser")).not.toBeNull()

    await resetScenario()

    // The write was in flight for the pre-reset world (a latency-delayed
    // mutation, still awaiting its persist when Reset ran). It settles only
    // now, after clearSourceData and the fresh (scenario, revision) stamp —
    // writing here would resurrect the old tree while the stamp suppresses
    // the reseed that should have caught it.
    await engine.create({ parentId: "1", title: "Too late" })
    expect(await devGet(SOURCES_STORE, "tree:browser")).toBeNull()

    // The reloaded world persists normally again: writes from engines of
    // the new revision land.
    resetDevRuntime()
    setPlatformCapabilities(getScenarioCaps())
    await ensureDevRuntime()
    const fresh = await engineFor("browser", "browser", seed)
    await fresh.create({ parentId: "1", title: "After reload" })
    const stored = await devGet<Record<string, unknown>>(
      SOURCES_STORE,
      "tree:browser"
    )
    expect(stored).not.toBeNull()
    expect(JSON.stringify(stored)).toContain("After reload")
  })

  it("reset can switch scenarios, resetting faults to that scenario's defaults", async () => {
    await ensureDevRuntime()
    await setFaults({ daemonLatencyMs: 3000 })

    await resetScenario("daemon-offline")

    expect(window.location.assign).toHaveBeenCalledWith(
      "/?scenario=daemon-offline"
    )
    resetDevRuntime()
    setPlatformCapabilities(null)
    vi.stubGlobal("location", {
      search: "?scenario=daemon-offline",
      assign: vi.fn(),
    })
    const runtime = await ensureDevRuntime()
    expect(runtime.state.scenarioId).toBe("daemon-offline")
    expect(runtime.state.faults).toMatchObject({
      daemonOnline: false,
      daemonLatencyMs: 0,
    })
  })
})

function getScenarioCaps() {
  // A fresh, un-overridden capability set for between-bootstrap resets.
  return {
    buildTarget: "chrome" as const,
    browserSource: true,
    omnibox: false,
    isExtension: false,
    daemonSource: true,
  }
}
