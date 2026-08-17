/**
 * The Dev Workbench's SourceEnvironment: the simulated world `bun run dev`
 * runs in. It answers the seam's questions from the active scenario — its
 * capabilities, its adapters, its daemons — and implements the connect flow
 * without any network at all: the simulated daemons live in memory, so the
 * workbench can never reach a real daemon or a real port.
 */

import type {
  ConnectionDiscovery,
  DaemonCredentials,
  SourceEnvironment,
} from "@/sources/environment"
import {
  DaemonEndpointError,
  canonicalizeDaemonOrigin,
} from "@/browser/daemon/endpoint"
import { currentFaults, currentScenario, ensureDevRuntime } from "./runtime"
import { devAdapterForSource } from "./adapters"
import { delay } from "./state"

/**
 * Resolves the dev environment, bootstrapping the scenario world first.
 * Called from the SourceEnvironment seam only on a dev-server page, so none
 * of this module's graph can reach a production bundle.
 */
export async function devSourceEnvironment(): Promise<SourceEnvironment> {
  await ensureDevRuntime()

  return {
    capabilities: () => currentScenario().capabilities,

    adapterFor: (source) => devAdapterForSource(source),

    async connect(originInput, options = {}) {
      void options
      let origin: string
      try {
        origin = canonicalizeDaemonOrigin(originInput)
      } catch (error) {
        return {
          ok: false,
          stage: "validate",
          message:
            error instanceof DaemonEndpointError
              ? error.message
              : "That address could not be used.",
        }
      }

      const scenario = currentScenario()
      const faults = currentFaults()

      if (faults.permissionDenied) {
        return {
          ok: false,
          stage: "permission",
          message:
            "Permission to reach the daemon was not granted (Dev Workbench failure control), so nothing was contacted.",
        }
      }

      const daemon = scenario.daemons.find((d) => d.origin === origin) ?? null
      if (!daemon) {
        const available =
          scenario.daemons.map((d) => d.origin).join(", ") || "none"
        return {
          ok: false,
          stage: "health",
          message: `No simulated daemon at ${origin}; this scenario provides: ${available}.`,
        }
      }

      if (!faults.daemonOnline) {
        return {
          ok: false,
          stage: "health",
          message: `No response from ${origin} within the timeout (Dev Workbench: the daemon is offline).`,
        }
      }

      await delay(faults.daemonLatencyMs)

      if (faults.discoveryFailure) {
        return {
          ok: false,
          stage: "discovery",
          message: `Could not list the Vaults at ${origin} (Dev Workbench failure control).`,
        }
      }

      return {
        ok: true,
        origin,
        warnings: [],
        vaults: daemon.vaults.map((vault) => ({
          id: vault.id,
          name: vault.name,
        })),
        legacyProtocol: false,
      }
    },

    async refreshDiscoveries(
      connections: Record<string, DaemonCredentials>
    ): Promise<ConnectionDiscovery[]> {
      const scenario = currentScenario()
      const faults = currentFaults()
      const discoveries: ConnectionDiscovery[] = []

      for (const origin of Object.keys(connections)) {
        const daemon = scenario.daemons.find((d) => d.origin === origin)
        if (!daemon) continue
        if (!faults.daemonOnline) continue
        await delay(faults.daemonLatencyMs)
        if (faults.discoveryFailure) continue
        discoveries.push({
          origin,
          vaults: daemon.vaults.map((vault) => ({
            id: vault.id,
            name: vault.name,
          })),
          legacyProtocol: false,
        })
      }
      return discoveries
    },

    discoveryAtStartup: false,

    async releaseDaemonAccess() {
      // There is no host permission to release in a simulated world.
    },
  }
}
