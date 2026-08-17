/**
 * The SourceEnvironment seam: everything environment-specific about how
 * sources come to life — what this runtime can do, which concrete adapter
 * backs a source, how a daemon connection is made and discovered, and how
 * daemon access is released again.
 *
 * The source store works only against this interface, so "which world are we
 * running in" is answered in exactly two places: the production environment
 * below (extension and daemon-served builds) and — in dev only — the Dev
 * Workbench's simulated environment, resolved lazily and never present in a
 * production bundle.
 */

import type { BrowserAdapter } from "@/browser"
import type {
  DaemonConnectOptions,
  DaemonConnectResult,
  DaemonVault,
} from "@/browser/daemon"
import {
  DaemonClient,
  connectToDaemon,
  discoverDaemonVaults,
  removeDaemonHostPermission,
} from "@/browser/daemon"
import { createAdapterForSource } from "./adapters"
import type { SourceDescriptor } from "./descriptors"
import { platformCapabilities, type PlatformCapabilities } from "./platform"

/** The credentials one stored daemon connection carries. */
export interface DaemonCredentials {
  bearerToken?: string
}

/** What discovery learned about one connection, folded back into the config. */
export interface ConnectionDiscovery {
  origin: string
  vaults: DaemonVault[]
  legacyProtocol: boolean
}

export interface SourceEnvironment {
  /** The capabilities of this build and runtime. */
  capabilities(): PlatformCapabilities
  /**
   * The adapter for one source, per this environment's world. Async because
   * an environment may need to bring a source's backing store to life
   * first.
   */
  adapterFor(
    source: SourceDescriptor,
    connections: Record<string, DaemonCredentials>
  ): Promise<BrowserAdapter>
  /**
   * The full connect flow for a user-typed address: validate, permission,
   * health, discovery. Persists nothing — writing the Source Configuration
   * stays the caller's decision.
   */
  connect(
    originInput: string,
    options?: DaemonConnectOptions
  ): Promise<DaemonConnectResult>
  /**
   * Best-effort discovery for every daemon this environment can currently
   * reach. Unreachable daemons are simply absent from the result: their
   * sources keep whatever the profile already stored.
   */
  refreshDiscoveries(
    connections: Record<string, DaemonCredentials>
  ): Promise<ConnectionDiscovery[]>
  /**
   * Whether the first profile load must fold discovery in before the sources
   * are shown. True only for the daemon-served app, whose same-origin daemon
   * is the only way it learns which Vaults exist.
   */
  readonly discoveryAtStartup: boolean
  /**
   * Releases environment-held daemon access (the extension's loopback host
   * permission) once the last connection is gone.
   */
  releaseDaemonAccess(): Promise<void>
}

/**
 * The production environment: extension builds and the daemon-served app.
 * Every capability is delegated — this module adds no policy of its own, so
 * a test that mocks `@/sources/adapters` or `@/browser/daemon` is testing
 * exactly what this environment forwards to.
 */
export const productionSourceEnvironment: SourceEnvironment = {
  capabilities() {
    return platformCapabilities()
  },
  adapterFor(source, connections) {
    return Promise.resolve(createAdapterForSource(source, connections))
  },
  connect(originInput, options) {
    return connectToDaemon(originInput, options)
  },
  async refreshDiscoveries(connections) {
    const caps = platformCapabilities()
    // The served app's same-origin daemon is discovered even though no
    // stored connection names it: the page *is* the daemon's client.
    const origins = new Set(Object.keys(connections))
    if (caps.buildTarget === "daemon") origins.add("")

    const discoveries: ConnectionDiscovery[] = []
    for (const origin of origins) {
      const client = new DaemonClient({ origin, ...connections[origin] })
      try {
        const discovery = await discoverDaemonVaults(client)
        discoveries.push({ origin, ...discovery })
      } catch {
        // An unreachable connection keeps its sources as-is: the user chose
        // them, and the failure surfaces on the source itself.
      }
    }
    return discoveries
  },
  get discoveryAtStartup() {
    return platformCapabilities().buildTarget === "daemon"
  },
  async releaseDaemonAccess() {
    // Best-effort: a permission the browser declines to release is not worth
    // failing the forget over.
    await removeDaemonHostPermission().catch(() => {})
  },
}

/**
 * Whether the Dev Workbench can be active in this context: a Vite dev-server
 * page (`DEV`), but never a unit test run and never a production build.
 */
export function devWorkbenchEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.MODE !== "test"
}

let resolved: Promise<SourceEnvironment> | null = null

/**
 * The environment this page runs in. Production pages resolve synchronously
 * to the production environment; a dev-server page resolves to the Dev
 * Workbench's simulated one (bootstrapping it first). Memoized so every
 * caller — bootstrap, switches, connects — shares one environment.
 *
 * The dev guard is written inline (not via {@link devWorkbenchEnabled}) so
 * the build-time constants fold it to `false` and rollup eliminates the
 * dynamic import — and with it the entire dev chunk — from production
 * bundles.
 */
export function resolveSourceEnvironment(): Promise<SourceEnvironment> {
  resolved ??=
    import.meta.env.DEV && import.meta.env.MODE !== "test"
      ? import("@/dev/environment").then((m) => m.devSourceEnvironment())
      : Promise.resolve(productionSourceEnvironment)
  return resolved
}

/** Test seam: forget the memoized environment between tests. */
export function resetSourceEnvironment(): void {
  resolved = null
}
