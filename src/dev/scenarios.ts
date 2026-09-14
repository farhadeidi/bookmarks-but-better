/**
 * The deterministic scenarios the Dev Workbench exposes. A scenario owns
 * three things, and together they are a complete world:
 *
 * - the Platform Capabilities the scenario claims (Safari has no Browser
 *   Source; a dev page has no extension APIs of its own to offer);
 * - the simulated daemons it hosts, each with named Vaults and seeded trees;
 * - the Source Configuration a profile in that world starts from.
 *
 * Seeds are pure data and fully deterministic: the same scenario at the same
 * revision always reseeds the same bookmarks, so "Reset Scenario" is a
 * promise, not an aspiration.
 */

import {
  BROWSER_SOURCE_ID,
  STANDALONE_SOURCE_ID,
  daemonSourceId,
  emptySourceConfig,
  enabledSourceIds,
  upsertDaemonSource,
  type SourceConfig,
} from "@/sources/config"
import type { PlatformCapabilities } from "@/sources/platform"
import type { DevFaultControls } from "./state"
import seedBookmarks from "./seed-bookmarks.json"

/** One node of a seed tree. Ids are assigned deterministically at seeding. */
export interface SeedNode {
  title: string
  url?: string
  children?: SeedNode[]
}

export interface DevVaultSeed {
  id: string
  name: string
  tree: SeedNode[]
}

export interface DevDaemonSeed {
  origin: string
  vaults: DevVaultSeed[]
}

export interface DevScenario {
  id: string
  label: string
  description: string
  capabilities: PlatformCapabilities
  /** The browser source's seeded bookmarks; `null` when there is none. */
  browserTree: SeedNode[] | null
  /** The legacy standalone source's seeded bookmarks; `null` when absent. */
  standaloneTree: SeedNode[] | null
  daemons: DevDaemonSeed[]
  /** The source a profile in this scenario starts on. */
  activeSource: string | null
  /** Failure controls the scenario starts with, over the defaults. */
  faults?: Partial<DevFaultControls>
  /** Whether product onboarding has been completed in this profile. */
  onboardingCompleted: boolean
}

export const DEFAULT_SCENARIO_ID = "browser-daemon"

function devCapabilities(
  overrides: Partial<PlatformCapabilities> = {}
): PlatformCapabilities {
  return {
    buildTarget: "chrome",
    browserSource: true,
    omnibox: false,
    newTabOverride: true,
    isExtension: false,
    daemonSource: true,
    ...overrides,
  }
}

const ORIGIN = "http://127.0.0.1:52222"

interface RawSeedNode {
  title: string
  url?: string
  children?: RawSeedNode[]
}

function asSeedNodes(nodes: RawSeedNode[]): SeedNode[] {
  return nodes.map((node) => ({
    title: node.title,
    ...(node.url ? { url: node.url } : {}),
    ...(node.children ? { children: asSeedNodes(node.children) } : {}),
  }))
}

const seedRoot = seedBookmarks[0] as RawSeedNode
const seedBookmarksBar = seedRoot.children?.find(
  (node) => node.title === "Bookmarks Bar"
)
const browserBookmarks = asSeedNodes(seedBookmarksBar?.children ?? [])

const readingVault: SeedNode[] = [
  {
    title: "Articles",
    children: [
      {
        title: "SQLite is not a toy database",
        url: "https://the-paper-trail.org",
      },
      {
        title: "The B-tree database",
        url: "https://arxiv.org",
      },
      {
        title: "Writing a simple JSON parser",
        url: "https://github.com",
      },
    ],
  },
  {
    title: "Blogs",
    children: [
      { title: "Fabien Sanglard", url: "https://fabiensanglard.net" },
      { title: "Brent Simmons", url: "https://inessential.com" },
    ],
  },
  { title: "Research Queue", url: "https://obsidian.md" },
]

const archiveVault: SeedNode[] = [
  {
    title: "2024",
    children: [
      { title: "State of CSS 2024", url: "https://stateofcss.com" },
      { title: "Rust in 2024", url: "https://rust-lang.org" },
    ],
  },
  {
    title: "2023",
    children: [
      { title: "The Tally Room", url: "https://tallyroom.com.au" },
      { title: "Old but gold", url: "https://example.com" },
    ],
  },
]

const researchVault: SeedNode[] = [
  {
    title: "Papers",
    children: [
      { title: "CRDTs: The Hard Parts", url: "https://arxiv.org" },
      { title: "Raft Consensus", url: "https://raft.github.io" },
    ],
  },
  { title: "Notes Index", url: "https://example.com" },
]

const travelVault: SeedNode[] = [
  {
    title: "Japan 2026",
    children: [
      { title: "JR Pass Calculator", url: "https://japan-guide.com" },
      { title: "Tokyo Subway Map", url: "https://tokyometro.jp" },
    ],
  },
  { title: "Visa Checker", url: "https://example.com" },
]

const standaloneTree: SeedNode[] = [
  {
    title: "Personal",
    children: [
      { title: "Bank", url: "https://example.com/bank" },
      { title: "Utilities", url: "https://example.com/utilities" },
    ],
  },
  { title: "Recipes", url: "https://example.com/recipes" },
]

/** Deterministic large library: `folders` folders of `per` bookmarks each. */
function largeLibrary(
  prefix: string,
  folders: number,
  per: number
): SeedNode[] {
  return Array.from({ length: folders }, (_, f) => ({
    title: `${prefix} Folder ${f + 1}`,
    children: Array.from({ length: per }, (_, b) => ({
      title: `${prefix} ${f + 1}.${b + 1}`,
      url: `https://example.com/${prefix.toLowerCase()}/${f + 1}/${b + 1}`,
    })),
  }))
}

/**
 * Deterministic huge library: `folders` top-level folders, each holding `per`
 * direct bookmarks and `subfolders` subfolders of `per` bookmarks, with a
 * third level under the first subfolder. The shape is what issue #75
 * describes — 10k+ bookmarks across several nesting levels.
 */
function hugeLibrary(
  prefix: string,
  folders: number,
  subfolders: number,
  per: number
): SeedNode[] {
  const bookmarks = (path: string): SeedNode[] =>
    Array.from({ length: per }, (_, b) => ({
      title: `${prefix} ${path}.${b + 1}`,
      url: `https://example.com/${prefix.toLowerCase()}/${path.replaceAll(".", "/")}/${b + 1}`,
    }))
  return Array.from({ length: folders }, (_, f) => ({
    title: `${prefix} Folder ${f + 1}`,
    children: [
      ...bookmarks(`${f + 1}`),
      ...Array.from({ length: subfolders }, (_, sf) => ({
        title: `${prefix} Folder ${f + 1}.${sf + 1}`,
        children: [
          ...bookmarks(`${f + 1}.${sf + 1}`),
          ...(sf === 0
            ? [
                {
                  title: `${prefix} Folder ${f + 1}.${sf + 1}.1`,
                  children: bookmarks(`${f + 1}.${sf + 1}.1`),
                },
              ]
            : []),
        ],
      })),
    ],
  }))
}

/** Mulberry32: a tiny seeded PRNG, so a "random" tree is the same every run. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Deterministic, irregular large tree for performance work (issue #85):
 * exactly `folders` folders and `bookmarks` bookmarks, with `topLevel`
 * top-level folders and the rest hung under random folders at most four
 * levels deep. Folder sizes are skewed — a few big folders, many small ones —
 * so card heights vary the way a real collection's do.
 */
function largeTree(
  prefix: string,
  options: {
    topLevel: number
    folders: number
    bookmarks: number
    seed: number
  }
): SeedNode[] {
  const MAX_DEPTH = 4
  const random = seededRandom(options.seed)

  interface Draft {
    path: string
    depth: number
    weight: number
    subfolders: Draft[]
  }
  const all: Draft[] = []
  const top: Draft[] = []
  const draft = (path: string, depth: number): Draft => {
    const node = { path, depth, weight: random() ** 3, subfolders: [] }
    all.push(node)
    return node
  }

  for (let i = 0; i < options.topLevel; i++) top.push(draft(`${i + 1}`, 1))
  while (all.length < options.folders) {
    const parents = all.filter((node) => node.depth < MAX_DEPTH)
    const parent = parents[Math.floor(random() * parents.length)]
    parent.subfolders.push(
      draft(`${parent.path}.${parent.subfolders.length + 1}`, parent.depth + 1)
    )
  }

  // Share the bookmarks out by weight, handing the rounding remainder to the
  // first folders so the total is exact.
  const totalWeight = all.reduce((sum, node) => sum + node.weight, 0)
  const counts = all.map((node) =>
    Math.floor((node.weight / totalWeight) * options.bookmarks)
  )
  let remainder = options.bookmarks - counts.reduce((sum, n) => sum + n, 0)
  for (let i = 0; remainder > 0; i = (i + 1) % counts.length, remainder--) {
    counts[i] += 1
  }
  const countOf = new Map(all.map((node, i) => [node, counts[i]]))

  const build = (node: Draft): SeedNode => ({
    title: `${prefix} ${node.path}`,
    children: [
      ...Array.from({ length: countOf.get(node) ?? 0 }, (_, b) => ({
        title: `${prefix} ${node.path} link ${b + 1}`,
        url: `https://example.com/${prefix.toLowerCase()}/${node.path.replaceAll(".", "/")}/${b + 1}`,
      })),
      ...node.subfolders.map(build),
    ],
  })
  return top.map(build)
}

function withBrowserAndDaemons(
  base: Pick<DevScenario, "id" | "label" | "description">,
  options: {
    browserTree?: SeedNode[] | null
    daemons?: DevDaemonSeed[]
    activeSource?: string | null
    faults?: Partial<DevFaultControls>
    onboardingCompleted?: boolean
  }
): DevScenario {
  return {
    ...base,
    capabilities: devCapabilities(),
    browserTree:
      options.browserTree !== undefined
        ? options.browserTree
        : browserBookmarks,
    standaloneTree: null,
    daemons: options.daemons ?? [],
    activeSource:
      options.activeSource !== undefined
        ? options.activeSource
        : BROWSER_SOURCE_ID,
    faults: options.faults,
    onboardingCompleted: options.onboardingCompleted ?? true,
  }
}

const browserDaemonDaemons: DevDaemonSeed[] = [
  {
    origin: ORIGIN,
    vaults: [
      { id: "reading", name: "reading", tree: readingVault },
      { id: "archive", name: "archive", tree: archiveVault },
    ],
  },
]

export const DEV_SCENARIOS: DevScenario[] = [
  {
    id: "fresh-chrome",
    label: "Fresh Chrome profile",
    description:
      "A brand-new extension profile: only the empty Browser Source, and onboarding still to do.",
    // The one scenario that claims to be an extension in a real Chrome: it is
    // the only place the wizard's source question and the omnibox keyword the
    // last step teaches are inspectable at all. Every other scenario runs as
    // the plain web app the workbench actually is.
    capabilities: devCapabilities({ isExtension: true, omnibox: true }),
    browserTree: [],
    standaloneTree: null,
    daemons: [],
    activeSource: BROWSER_SOURCE_ID,
    onboardingCompleted: false,
  },
  withBrowserAndDaemons(
    {
      id: "browser-only",
      label: "Browser only",
      description: "The Browser Source with bookmarks, no daemon connected.",
    },
    { daemons: [] }
  ),
  withBrowserAndDaemons(
    {
      id: DEFAULT_SCENARIO_ID,
      label: "Browser + daemon",
      description:
        "The default: browser bookmarks plus a daemon hosting the reading and archive Vaults.",
    },
    { daemons: browserDaemonDaemons }
  ),
  withBrowserAndDaemons(
    {
      id: "multi-vault",
      label: "Multi-vault daemon",
      description:
        "One daemon hosting four Vaults and no Browser Source — switching is the whole UI.",
    },
    {
      browserTree: null,
      daemons: [
        {
          origin: ORIGIN,
          vaults: [
            { id: "reading", name: "reading", tree: readingVault },
            { id: "archive", name: "archive", tree: archiveVault },
            { id: "research", name: "research", tree: researchVault },
            { id: "travel", name: "travel", tree: travelVault },
          ],
        },
      ],
      activeSource: daemonSourceId(ORIGIN, "reading"),
    }
  ),
  withBrowserAndDaemons(
    {
      id: "daemon-offline",
      label: "Daemon offline",
      description:
        "Browser plus a daemon that is currently unreachable — the failure controls start with the daemon offline.",
    },
    { daemons: browserDaemonDaemons, faults: { daemonOnline: false } }
  ),
  withBrowserAndDaemons(
    {
      id: "slow-daemon",
      label: "Slow daemon",
      description:
        "Every simulated daemon operation takes 1.2s — loading states, the way they were meant to be seen.",
    },
    {
      daemons: browserDaemonDaemons,
      activeSource: daemonSourceId(ORIGIN, "reading"),
      faults: { daemonLatencyMs: 1200 },
    }
  ),
  {
    id: "legacy-standalone",
    label: "Legacy Standalone profile",
    description:
      "A profile in the sunset cohort: the legacy Standalone source is enabled, active, and announcing its retirement.",
    capabilities: devCapabilities(),
    browserTree: browserBookmarks,
    standaloneTree,
    daemons: [],
    activeSource: STANDALONE_SOURCE_ID,
    onboardingCompleted: true,
  },
  {
    id: "safari",
    label: "Safari (daemon-only)",
    description:
      "Safari's world: no Browser Source and no omnibox — a daemon Vault is the only way in.",
    capabilities: devCapabilities({
      buildTarget: "safari",
      browserSource: false,
      isExtension: true,
      // Safari's manifest declares no new-tab override; a scenario that
      // claimed one would let a surface promise a new tab page Safari never
      // gives it, which is the whole thing this scenario exists to catch.
      newTabOverride: false,
    }),
    browserTree: null,
    standaloneTree: null,
    daemons: [
      {
        origin: ORIGIN,
        vaults: [{ id: "reading", name: "reading", tree: readingVault }],
      },
    ],
    activeSource: daemonSourceId(ORIGIN, "reading"),
    onboardingCompleted: true,
  },
  {
    id: "fresh-safari",
    label: "Fresh Safari profile",
    description:
      "Safari's world before setup: no source at all, and onboarding with no source question to ask.",
    capabilities: devCapabilities({
      buildTarget: "safari",
      browserSource: false,
      isExtension: true,
      newTabOverride: false,
    }),
    browserTree: null,
    standaloneTree: null,
    daemons: [],
    activeSource: null,
    onboardingCompleted: false,
  },
  {
    id: "empty",
    label: "No sources",
    description:
      "A profile with nothing enabled at all — the dashboard's own empty state.",
    capabilities: devCapabilities(),
    browserTree: null,
    standaloneTree: null,
    daemons: [],
    activeSource: null,
    onboardingCompleted: true,
  },
  withBrowserAndDaemons(
    {
      id: "large-library",
      label: "Large library",
      description:
        "Hundreds of seeded bookmarks across the browser source and both Vaults.",
    },
    {
      browserTree: [...browserBookmarks, ...largeLibrary("Browser", 8, 25)],
      daemons: [
        {
          origin: ORIGIN,
          vaults: [
            {
              id: "reading",
              name: "reading",
              tree: [...readingVault, ...largeLibrary("Reading", 8, 25)],
            },
            {
              id: "archive",
              name: "archive",
              tree: [...archiveVault, ...largeLibrary("Archive", 8, 25)],
            },
          ],
        },
      ],
    }
  ),
  withBrowserAndDaemons(
    {
      id: "huge-library",
      label: "Huge library",
      description:
        "Over ten thousand bookmarks in nested folders on the browser source — the collection size from issue #75.",
    },
    {
      // 40 × (30 + 6 × 30 + 30) = 9,600 generated bookmarks plus the seed,
      // on top of 320 folders across three nesting levels.
      browserTree: [...browserBookmarks, ...hugeLibrary("Browser", 40, 6, 30)],
    }
  ),
  withBrowserAndDaemons(
    {
      id: "large-tree",
      label: "Large tree",
      description:
        "Exactly 10,000 bookmarks in 300 irregular folders up to four levels deep, from a seeded generator — the fixture for measuring grid performance (issue #85).",
    },
    {
      browserTree: largeTree("Tree", {
        topLevel: 12,
        folders: 300,
        bookmarks: 10_000,
        seed: 85,
      }),
    }
  ),
]

export function getScenario(id: string): DevScenario {
  return (
    DEV_SCENARIOS.find((scenario) => scenario.id === id) ??
    DEV_SCENARIOS.find((scenario) => scenario.id === DEFAULT_SCENARIO_ID)!
  )
}

export function isScenarioId(id: string): boolean {
  return DEV_SCENARIOS.some((scenario) => scenario.id === id)
}

/**
 * The Source Configuration a profile in this scenario starts from: every
 * simulated Vault connected and enabled, the Browser Source present exactly
 * when the scenario has one, and the scenario's declared Active Source.
 */
export function initialConfigFor(scenario: DevScenario): SourceConfig {
  const caps = scenario.capabilities
  let config = emptySourceConfig()

  if (scenario.browserTree !== null && caps.browserSource) {
    config.sources[BROWSER_SOURCE_ID] = { enabled: true }
  }
  if (scenario.standaloneTree !== null) {
    config.sources[STANDALONE_SOURCE_ID] = { enabled: true, legacy: true }
  }
  for (const daemon of scenario.daemons) {
    config.connections[daemon.origin] = {}
    for (const vault of daemon.vaults) {
      config = upsertDaemonSource(
        config,
        daemon.origin,
        { id: vault.id, name: vault.name },
        { enabled: true }
      )
    }
  }

  const enabled = enabledSourceIds(config)
  const wanted =
    scenario.activeSource && config.sources[scenario.activeSource]?.enabled
      ? scenario.activeSource
      : null
  config.activeSourceId = wanted ?? enabled[0] ?? null
  return config
}
