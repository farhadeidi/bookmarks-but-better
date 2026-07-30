/**
 * The one path that is allowed to turn "the user typed an address and clicked
 * Connect" into a persisted daemon connection.
 *
 * Every step has to succeed, in this order, before anything is written:
 *
 * 1. **Validate** — {@link canonicalizeDaemonOrigin}, the same loopback-only
 *    check the daemon itself enforces.
 * 2. **Permission** — request the host permission, only now, from the
 *    Connect button's own click (see `./permissions`).
 * 3. **Health-check** — an actual `GET /health` against the address, so
 *    "Connect" cannot succeed against a port nothing is listening on.
 *
 * A failure at any step returns a result the caller renders and **persists
 * nothing** — the previously configured source (whatever `adapterMode` and
 * connection config were already stored) is left exactly as it was. This is
 * what makes a failed or denied connection attempt safe to retry: there is
 * never a half-applied state to undo.
 */

import {
  clearDaemonConnectionConfig,
  setAdapterModePreference,
  setDaemonConnectionConfig,
} from "../adapter-preference"
import { canonicalizeDaemonOrigin, DaemonEndpointError } from "./endpoint"
import { DaemonApiError, DaemonClient } from "./client"
import {
  removeDaemonHostPermission,
  requestDaemonHostPermission,
} from "./permissions"
import type { BookmarkDiagnostic } from "../types"

export type DaemonConnectStage = "validate" | "permission" | "health"

export type DaemonConnectResult =
  | { ok: true; origin: string; warnings: BookmarkDiagnostic[] }
  | { ok: false; stage: DaemonConnectStage; message: string }

export interface DaemonConnectOptions {
  bearerToken?: string
  /** Test-only seam: injected into the throwaway health-check client. */
  fetchImpl?: typeof fetch
}

/**
 * Attempts to connect to the daemon at `originInput`, persisting the
 * connection and switching `adapterMode` to `"daemon"` only if every step
 * succeeds.
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

    await setDaemonConnectionConfig({
      origin,
      bearerToken: options.bearerToken,
    })
    await setAdapterModePreference("daemon")

    return { ok: true, origin, warnings: health.warnings ?? [] }
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

/**
 * Switches away from daemon mode without discarding the saved connection.
 *
 * The connection config — and its host permission — are left in place, so a
 * later "Connect" can reuse them without the user retyping the address. Used
 * by the settings dialog's "Disconnect" action.
 */
export async function disconnectDaemon(
  fallbackMode: "browser" | "standalone"
): Promise<void> {
  await setAdapterModePreference(fallbackMode)
}

/**
 * Forgets the daemon connection entirely: clears the stored endpoint (and any
 * bearer token with it), releases the host permission, and switches away from
 * daemon mode. Used by the settings dialog's "Forget" action.
 */
export async function forgetDaemon(
  fallbackMode: "browser" | "standalone"
): Promise<void> {
  await clearDaemonConnectionConfig()
  await removeDaemonHostPermission()
  await setAdapterModePreference(fallbackMode)
}
