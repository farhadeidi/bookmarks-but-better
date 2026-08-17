import { describe, expect, it } from "vitest"
import { daemonSourceId } from "@/sources/config"
import {
  DEFAULT_SCENARIO_ID,
  DEV_SCENARIOS,
  initialConfigFor,
  getScenario,
} from "./scenarios"

const ORIGIN = "http://127.0.0.1:52222"

describe("the scenario registry", () => {
  it("exposes exactly the documented scenarios", () => {
    expect(DEV_SCENARIOS.map((s) => s.id)).toEqual([
      "fresh-chrome",
      "browser-only",
      "browser-daemon",
      "multi-vault",
      "daemon-offline",
      "slow-daemon",
      "legacy-standalone",
      "safari",
      "empty",
      "large-library",
    ])
    expect(DEFAULT_SCENARIO_ID).toBe("browser-daemon")
  })

  it("every scenario has a unique id and a buildable config", () => {
    const ids = new Set<string>()
    for (const scenario of DEV_SCENARIOS) {
      expect(ids.has(scenario.id)).toBe(false)
      ids.add(scenario.id)
      expect(() => initialConfigFor(scenario)).not.toThrow()
    }
  })
})

describe("initial source configuration", () => {
  it("the default scenario connects browser bookmarks plus the reading and archive Vaults", () => {
    const config = initialConfigFor(getScenario("browser-daemon"))

    expect(config.sources.browser).toEqual({ enabled: true })
    expect(config.sources[daemonSourceId(ORIGIN, "reading")]).toMatchObject({
      enabled: true,
      name: "reading",
    })
    expect(config.sources[daemonSourceId(ORIGIN, "archive")]).toMatchObject({
      enabled: true,
      name: "archive",
    })
    expect(config.connections[ORIGIN]).toEqual({})
    expect(config.activeSourceId).toBe("browser")
  })

  it("initial configurations are deterministic", () => {
    const scenario = getScenario("multi-vault")
    expect(initialConfigFor(scenario)).toEqual(initialConfigFor(scenario))
  })

  it("multi-vault hosts four Vaults with no Browser Source", () => {
    const config = initialConfigFor(getScenario("multi-vault"))

    expect(config.sources.browser).toBeUndefined()
    expect(config.activeSourceId).toBe(daemonSourceId(ORIGIN, "reading"))
    for (const vault of ["reading", "archive", "research", "travel"]) {
      expect(config.sources[daemonSourceId(ORIGIN, vault)]).toMatchObject({
        enabled: true,
      })
    }
  })

  it("safari's world has no Browser Source and starts on its Vault", () => {
    const scenario = getScenario("safari")
    expect(scenario.capabilities.browserSource).toBe(false)
    expect(scenario.capabilities.buildTarget).toBe("safari")

    const config = initialConfigFor(scenario)
    expect(config.sources.browser).toBeUndefined()
    expect(config.activeSourceId).toBe(daemonSourceId(ORIGIN, "reading"))
  })

  it("the empty scenario has nothing enabled at all", () => {
    const config = initialConfigFor(getScenario("empty"))
    expect(config.sources).toEqual({})
    expect(config.connections).toEqual({})
    expect(config.activeSourceId).toBeNull()
  })

  it("the legacy-standalone scenario is a sunset-cohort profile", () => {
    const config = initialConfigFor(getScenario("legacy-standalone"))
    expect(config.sources.standalone).toEqual({ enabled: true, legacy: true })
    expect(config.activeSourceId).toBe("standalone")
  })

  it("failure-prone scenarios start with their faults", () => {
    expect(getScenario("daemon-offline").faults).toEqual({
      daemonOnline: false,
    })
    expect(getScenario("slow-daemon").faults).toEqual({ daemonLatencyMs: 1200 })
  })

  it("only fresh-chrome still has onboarding to do", () => {
    for (const scenario of DEV_SCENARIOS) {
      expect(scenario.onboardingCompleted).toBe(
        scenario.id === "fresh-chrome" ? false : true
      )
    }
  })
})
