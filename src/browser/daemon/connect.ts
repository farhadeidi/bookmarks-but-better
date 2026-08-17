/**
 * The one path that is allowed to turn "the user typed an address and clicked
 * Connect" into a working daemon connection.
 *
 * Every step has to succeed, in this order, before anything is returned as
 * `ok`:
 *
 * 1. **Validate** — {@link canonicalizeDaemonOrigin}, the same loopback-only
 *    check the daemon itself enforces.
 * 2. **Permission** — request the host permission, only now, from the
 *    Connect button's own click (see `./permissions`).
 * 3. **Health-check** — an actual `GET /health` against the address, so
 *    "Connect" cannot succeed against a port nothing is listening on.
 * 4. **Discovery** — `GET /vaults`, so the caller learns which Vaults this
 *    daemon hosts and can offer each as a source.
 *
 * This module deliberately persists nothing. A failure at any step returns a
 * result the caller renders and leaves every stored preference exactly as it
 * was — including on success: writing the Source Configuration is the caller's
 * decision, made once it knows what to write. That is what keeps a failed or
 * cancelled connection attempt safe to retry: there is never a half-applied
 * state to undo.
 */

import { canonicalizeDaemonOrigin, DaemonEndpointError } from "./endpoint"
import { DaemonApiError, DaemonClient, type DaemonVault } from "./client"
import { requestDaemonHostPermission } from "./permissions"
import type { BookmarkDiagnostic } from "../types"

export type DaemonConnectStage =
  | "validate"
  | "permission"
  | "health"
  | "discovery"

export type DaemonConnectResult =
  | {
      ok: true
      origin: string
      warnings: BookmarkDiagnostic[]
      /**
       * The Vaults this daemon hosts, for the caller to add as sources. A
       * daemon from before Vaults had ids answers `route_not_found` to
       * discovery; that is reported as one vault under the id `default`
       * rather than as a failure, because everything else about the
       * connection works.
       */
      vaults: DaemonVault[]
      /**
       * True when the daemon predates Vault ids and must be talked to through
       * the legacy unscoped routes. Scoping requests to `/vaults/…` against
       * such a daemon would 404 on every call.
       */
      legacyProtocol: boolean
    }
  | { ok: false; stage: DaemonConnectStage; message: string }

export interface DaemonConnectOptions {
  bearerToken?: string
  /** Test-only seam: injected into the throwaway probe clients. */
  fetchImpl?: typeof fetch
}

/** The id a pre-Vault-id daemon's single vault is addressed by. */
export const LEGACY_DISCOVERY_VAULT_ID = "default"

/** What discovery learned about a daemon. */
export interface DaemonDiscovery {
  vaults: DaemonVault[]
  /** True when the daemon predates Vault ids (unscoped routes only). */
  legacyProtocol: boolean
}

export async function discoverDaemonVaults(
  client: DaemonClient
): Promise<DaemonDiscovery> {
  try {
    const response = await client.fetchVaults()
    const vaults = (response.vaults ?? []).filter(
      (vault) => typeof vault?.id === "string" && vault.id !== ""
    )
    if (vaults.length > 0) return { vaults, legacyProtocol: false }
    // A daemon hosting zero vaults cannot be configured to do so; the only
    // honest reading is the legacy single-vault one.
    return {
      vaults: [{ id: LEGACY_DISCOVERY_VAULT_ID }],
      legacyProtocol: true,
    }
  } catch (error) {
    if (error instanceof DaemonApiError && error.code === "route_not_found") {
      return {
        vaults: [{ id: LEGACY_DISCOVERY_VAULT_ID }],
        legacyProtocol: true,
      }
    }
    throw error
  }
}

/**
 * Attempts to connect to the daemon at `originInput`.
 *
 * Used identically for "Connect" (a new or changed address) and "Retry" (the
 * same address again after a failure) — there is no separate code path for
 * either, since both are "try this address now" and both must leave prior
 * state untouched on failure.
 */
export async function connectToDaemon(
  originInput: string,
  options: DaemonConnectOptions = {}
): Promise<DaemonConnectResult> {
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

  const granted = await requestDaemonHostPermission()
  if (!granted) {
    return {
      ok: false,
      stage: "permission",
      message:
        "Permission to reach the daemon was not granted, so nothing was contacted.",
    }
  }

  const client = new DaemonClient({
    origin,
    bearerToken: options.bearerToken,
    fetchImpl: options.fetchImpl,
  })
  try {
    const health = await client.fetchHealth()
    if (health.status !== "ok") {
      return {
        ok: false,
        stage: "health",
        message: `The daemon at ${origin} reported an unhealthy status (${health.status}).`,
      }
    }

    const discovery = await discoverDaemonVaults(client)

    return {
      ok: true,
      origin,
      warnings: health.warnings ?? [],
      vaults: discovery.vaults,
      legacyProtocol: discovery.legacyProtocol,
    }
  } catch (error) {
    const message =
      error instanceof DaemonApiError
        ? error.isTimeout
          ? `No response from ${origin} within the timeout.`
          : error.message
        : error instanceof Error
          ? error.message
          : `Could not reach ${origin}.`
    return { ok: false, stage: "health", message }
  }
}
