/**
 * Turning persisted source entries into what the UI shows: one descriptor per
 * source, with a label the switcher, capture popup and omnibox all share.
 */

import type { SourceEntry, SourceKind } from "./config"
import {
  BROWSER_SOURCE_ID,
  STANDALONE_SOURCE_ID,
  parseDaemonSourceId,
} from "./config"

export interface SourceDescriptor {
  id: string
  kind: SourceKind
  /** The label every surface shows for this source. */
  label: string
  /** The source-owned label used when this profile has no custom label. */
  defaultLabel: string
  /** Daemon only: the connection's canonical origin. */
  origin?: string
  /** Daemon only: the vault's id on its daemon. */
  vaultId?: string
  /**
   * Daemon only: reach the vault through the legacy unscoped routes (the
   * daemon predates Vault ids). Adapters and the omnibox both consume this.
   */
  unscoped?: boolean
  /** Standalone only: this profile is in the sunset cohort. */
  legacy?: boolean
}

/** `http://127.0.0.1:52222` → `127.0.0.1:52222`; `""` → `this daemon`. */
function shortOrigin(origin: string): string {
  return origin.replace(/^https?:\/\//, "") || "this daemon"
}

export function describeSource(
  id: string,
  entry: SourceEntry
): SourceDescriptor {
  if (id === BROWSER_SOURCE_ID) {
    const defaultLabel = "Browser bookmarks"
    return {
      id,
      kind: "browser",
      defaultLabel,
      label: entry.label?.trim() || defaultLabel,
    }
  }
  if (id === STANDALONE_SOURCE_ID) {
    const defaultLabel = "Standalone (legacy)"
    return {
      id,
      kind: "standalone",
      defaultLabel,
      label: entry.label?.trim() || defaultLabel,
      legacy: entry.legacy,
    }
  }

  const daemon = parseDaemonSourceId(id)
  if (daemon) {
    const name = entry.name?.trim()
    const unscoped = entry.unscoped === true
    const defaultLabel = name
      ? name
      : unscoped
        ? shortOrigin(daemon.origin)
        : `${daemon.vaultId} · ${shortOrigin(daemon.origin)}`
    return {
      id,
      kind: "daemon",
      defaultLabel,
      label: entry.label?.trim() || defaultLabel,
      origin: daemon.origin,
      vaultId: entry.vaultId ?? daemon.vaultId,
      ...(unscoped ? { unscoped: true } : {}),
    }
  }

  // Unknown ids (a future kind, a corrupted entry) still need a label rather
  // than a crash; they sort last and cannot be created by this build.
  return {
    id,
    kind: "daemon",
    defaultLabel: id,
    label: entry.label?.trim() || id,
  }
}
