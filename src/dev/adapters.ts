/**
 * The dev adapters: `BrowserAdapter` implementations backed by the mutable
 * engine, with capabilities that honestly describe the source they simulate.
 *
 * Daemon-flavored adapters pass every operation through the fault gate —
 * offline, latency, mutation failure, stale responses — so the failure
 * controls exercise the application's real error paths (health probe, retry,
 * problem-code messages) rather than a dev-only approximation of them.
 */

import type {
  AdapterCapabilities,
  AdapterHealth,
  BookmarkAdapter,
  BookmarkNode,
  BrowserAdapter,
  FaviconProvider,
  StorageAdapter,
} from "@/browser"
import { DaemonApiError } from "@/browser/daemon/client"
import { GoogleFaviconV2Provider } from "@/browser/favicon/google-favicon-v2"
import { GoogleFaviconProvider } from "@/browser/favicon/google-favicon"
import type { SourceDescriptor } from "@/sources/descriptors"
import {
  materializeSeed,
  MutableBookmarkEngine,
  type EngineFlavor,
} from "./engine"
import { currentFaults, currentScenario, engineFor } from "./runtime"
import type { DevScenario, SeedNode } from "./scenarios"
import {
  currentSourceEpoch,
  delay,
  devDelete,
  devGet,
  devPutUnlessSealed,
  PREFS_STORE,
} from "./state"

const BROWSER_CAPABILITIES: AdapterCapabilities = {
  openInManager: false,
  move: true,
  reorder: true,
  setChildOrder: false,
  rootIsCreatable: false,
}

const STANDALONE_CAPABILITIES: AdapterCapabilities = {
  openInManager: false,
  move: true,
  reorder: true,
  setChildOrder: false,
  rootIsCreatable: true,
}

const DAEMON_CAPABILITIES: AdapterCapabilities = {
  openInManager: false,
  move: true,
  reorder: false,
  setChildOrder: true,
  rootIsCreatable: true,
}

const primaryFavicon = new GoogleFaviconV2Provider()
const fallbackFavicon = new GoogleFaviconProvider()

/** Exercise the same public favicon path used by production adapters. */
const devFavicon: FaviconProvider = {
  getUrl: (pageUrl) => primaryFavicon.getUrl(pageUrl),
  getFallbackUrl: (pageUrl) => fallbackFavicon.getUrl(pageUrl),
  isAvailable: () => true,
}

/** Source-scoped preference storage, one namespace per simulated source. */
class DevStorageAdapter implements StorageAdapter {
  private readonly sourceKey: string
  /**
   * The scenario epoch this adapter's world belongs to: a preference save
   * settling after a reset's wipe must not resurrect pre-reset preferences,
   * exactly like an engine's tree persist.
   */
  private readonly epoch: number

  constructor(sourceKey: string) {
    this.sourceKey = sourceKey
    this.epoch = currentSourceEpoch()
  }

  private key(id: string): string {
    return `${this.sourceKey}::${id}`
  }

  async get<T>(key: string): Promise<T | null> {
    return devGet<T>(PREFS_STORE, this.key(key))
  }

  async set<T>(key: string, value: T): Promise<void> {
    await devPutUnlessSealed(PREFS_STORE, this.key(key), value, this.epoch)
  }

  async remove(key: string): Promise<void> {
    await devDelete(PREFS_STORE, this.key(key))
  }
}

/**
 * A browser-shaped root: the synthetic id "0" with the well-known Bar/Other
 * children beneath it, exactly like the WebExtensions tree the Chrome and
 * Firefox adapters return.
 */
function browserSeed(children: SeedNode[]): BookmarkNode {
  return materializeSeed(
    "0",
    "",
    "b",
    [],
    [
      { id: "1", title: "Bookmarks Bar", children },
      { id: "2", title: "Other bookmarks", children: [] },
    ]
  )
}

/** A daemon-shaped root: one addressable, creatable vault root. */
function vaultSeed(title: string, children: SeedNode[]): BookmarkNode {
  return materializeSeed("root", title, "d", children)
}

function standaloneSeed(children: SeedNode[]): BookmarkNode {
  return materializeSeed(
    "standalone-root",
    "Standalone bookmarks",
    "s",
    children
  )
}

type Gate = <T>(op: () => Promise<T>, kind: "read" | "write") => Promise<T>

function engineAdapter(
  engine: MutableBookmarkEngine,
  sourceKey: string,
  capabilities: AdapterCapabilities,
  gate: Gate
): BrowserAdapter {
  const bookmarks: BookmarkAdapter = {
    getTree: () => gate(() => engine.getTree(), "read"),
    getSubTree: (id) => gate(() => engine.getSubTree(id), "read"),
    create: (bookmark) => gate(() => engine.create(bookmark), "write"),
    update: (id, changes) => gate(() => engine.update(id, changes), "write"),
    remove: (id) => gate(() => engine.remove(id), "write"),
    removeTree: (id) => gate(() => engine.removeTree(id), "write"),
    move: (id, destination) =>
      gate(() => engine.move(id, destination), "write"),
    setChildOrder:
      engine.simulatedFlavor === "daemon"
        ? (folderId, orderedChildIds) =>
            gate(() => engine.setChildOrder(folderId, orderedChildIds), "write")
        : undefined,
    onChanged: (cb) => engine.subscribe("changed", cb),
    onCreated: (cb) => engine.subscribe("created", cb),
    onRemoved: (cb) => engine.subscribe("removed", cb),
    onMoved: (cb) => engine.subscribe("moved", cb),
    openInManager: async () => {},
    dispose: () => engine.dispose(),
  }
  if (engine.simulatedFlavor === "daemon") {
    bookmarks.checkHealth = async (): Promise<AdapterHealth> => {
      const faults = currentFaults()
      await delay(faults.daemonLatencyMs)
      return faults.daemonOnline ? { ready: true } : { ready: false }
    }
  }
  return {
    bookmarks,
    storage: new DevStorageAdapter(sourceKey),
    favicon: devFavicon,
    capabilities,
  }
}

/** No fault gate: the browser source has no failure path worth faking. */
const passthroughGate: Gate = (op) => op()

/**
 * The daemon fault gate: offline refuses reads and writes alike (and the
 * health probe reports not-ready), latency delays both, and the write-only
 * faults exercise the application's mutation error paths with the daemon's
 * real problem semantics.
 */
async function daemonGate<T>(
  op: () => Promise<T>,
  kind: "read" | "write"
): Promise<T> {
  const faults = currentFaults()
  if (!faults.daemonOnline) {
    throw new DaemonApiError(
      "The daemon is offline (Dev Workbench failure control).",
      { isTimeout: true }
    )
  }
  await delay(faults.daemonLatencyMs)
  if (kind === "write") {
    if (faults.staleResponses) {
      throw new DaemonApiError(
        "Simulated stale revision (Dev Workbench failure control).",
        { code: "stale_revision", status: 409 }
      )
    }
    if (faults.mutationFailure) {
      throw new DaemonApiError(
        "Simulated mutation failure (Dev Workbench failure control).",
        { status: 500 }
      )
    }
  }
  return op()
}

function flavorCapabilities(flavor: EngineFlavor): AdapterCapabilities {
  if (flavor === "daemon") return DAEMON_CAPABILITIES
  if (flavor === "standalone") return STANDALONE_CAPABILITIES
  return BROWSER_CAPABILITIES
}

function findScenarioVault(
  scenario: DevScenario,
  source: SourceDescriptor
): { name: string; tree: SeedNode[] } | null {
  for (const daemon of scenario.daemons) {
    if (daemon.origin !== source.origin) continue
    const vault = daemon.vaults.find((v) => v.id === source.vaultId)
    if (vault) return { name: vault.name, tree: vault.tree }
  }
  return null
}

/**
 * Builds the dev adapter for one source descriptor against the active
 * scenario's world. The engine is keyed per source — two Vaults of one
 * daemon never share a tree. Unknown daemon sources (a config drift the
 * reseed should have prevented) resolve to an empty vault rather than a
 * crash.
 */
export async function devAdapterForSource(
  source: SourceDescriptor
): Promise<BrowserAdapter> {
  const scenario = currentScenario()

  if (source.kind === "browser") {
    const engine = await engineFor("browser", "browser", () =>
      browserSeed(scenario.browserTree ?? [])
    )
    return engineAdapter(
      engine,
      "browser",
      flavorCapabilities("browser"),
      passthroughGate
    )
  }

  if (source.kind === "standalone") {
    const engine = await engineFor("standalone", "standalone", () =>
      standaloneSeed(scenario.standaloneTree ?? [])
    )
    return engineAdapter(
      engine,
      "standalone",
      flavorCapabilities("standalone"),
      passthroughGate
    )
  }

  const vault = findScenarioVault(scenario, source)
  const engine = await engineFor(source.id, "daemon", () =>
    vaultSeed(vault?.name ?? source.label, vault?.tree ?? [])
  )
  return engineAdapter(
    engine,
    source.id,
    flavorCapabilities("daemon"),
    (op, kind) => daemonGate(op, kind)
  )
}
