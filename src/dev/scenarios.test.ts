import { describe, expect, it } from "vitest"
import type { BookmarkNode } from "@/browser"
import { daemonSourceId } from "@/sources/config"
import seedBookmarks from "./seed-bookmarks.json"
import seedPreferences from "./seed-preferences.json"
import { materializeSeed } from "./engine"
import {
  DEFAULT_SCENARIO_ID,
  DEV_SCENARIOS,
  initialConfigFor,
  getScenario,
} from "./scenarios"

const ORIGIN = "http://127.0.0.1:52222"

function countBookmarks(
  nodes: Array<{ url?: string; children?: Array<unknown> }>
): number {
  return nodes.reduce((count, node) => {
    const children = (node.children ?? []) as Array<{
      url?: string
      children?: Array<unknown>
    }>
    return count + (node.url ? 1 : 0) + countBookmarks(children)
  }, 0)
}

function folderIdsByTitle(nodes: BookmarkNode[], title: string): string[] {
  return nodes.flatMap((node) => [
    ...(node.title === title ? [node.id] : []),
    ...folderIdsByTitle(node.children ?? [], title),
  ])
}

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
      "fresh-safari",
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
  it("keeps the seeded grid folders unique and aligned with their generated ids", () => {
    const browserTree = getScenario(DEFAULT_SCENARIO_ID).browserTree ?? []
    const root = materializeSeed(
      "0",
      "",
      "b",
      [],
      [
        { id: "1", title: "Bookmarks Bar", children: browserTree },
        { id: "2", title: "Other bookmarks", children: [] },
      ]
    )
    const gridTitles = [
      "Bookmarks Bar",
      "Social",
      "Productivity",
      "Email",
      "Travel",
      "Gaming",
    ]
    const seededCardLayouts = seedPreferences.cardLayouts as Record<
      string,
      string
    >

    for (const title of gridTitles) {
      const ids = folderIdsByTitle(root.children ?? [], title)
      expect(ids).toHaveLength(1)
      expect(seededCardLayouts[ids[0] ?? ""]).toBe("grid")
    }

    expect(Object.keys(seedPreferences.cardLayouts).sort()).toEqual(
      ["1", "b5", "b22", "b173", "b184", "b262"].sort()
    )
  })

  it("seeds the default Browser Source from the complete development dataset", () => {
    const scenario = getScenario(DEFAULT_SCENARIO_ID)

    expect(countBookmarks(scenario.browserTree ?? [])).toBe(
      countBookmarks(seedBookmarks)
    )
    expect(countBookmarks(scenario.browserTree ?? [])).toBeGreaterThan(250)
  })

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

  it("a fresh Safari profile starts with no source and onboarding to do", () => {
    const scenario = getScenario("fresh-safari")
    expect(scenario.capabilities.browserSource).toBe(false)
    expect(scenario.onboardingCompleted).toBe(false)

    const config = initialConfigFor(scenario)
    expect(config.sources).toEqual({})
    expect(config.activeSourceId).toBeNull()
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

  it("only the fresh-profile scenarios still have onboarding to do", () => {
    const fresh = new Set(["fresh-chrome", "fresh-safari"])
    for (const scenario of DEV_SCENARIOS) {
      expect(scenario.onboardingCompleted).toBe(!fresh.has(scenario.id))
    }
  })
})
