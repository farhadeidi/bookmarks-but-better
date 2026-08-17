/**
 * Source Configuration: the set of enabled sources and the active source for
 * one browser profile. It is not shared with other browser profiles, never
 * synced, and is the single authority for which sources exist and which one
 * is Active.
 *
 * The persisted shape is versioned. Version 1 was the scalar `adapterMode`
 * plus one daemon connection; version 2 (this module) is a map of sources
 * keyed by stable id. Migration from v1 is one-directional and runs at most
 * once per profile, when no v2 document exists yet.
 */

import type { PlatformCapabilities } from "./platform"

export type SourceKind = "browser" | "standalone" | "daemon"

/** The major version in which the Standalone Source is fully removed. */
export const STANDALONE_REMOVAL_MAJOR_VERSION = 5

export const BROWSER_SOURCE_ID = "browser"
export const STANDALONE_SOURCE_ID = "standalone"

/** The daemon id a pre-Vault-id daemon's single vault is addressed by. */
export const LEGACY_VAULT_ID = "default"

/** `daemon:<origin>#<vaultId>` — stable while the connection and vault exist. */
export function daemonSourceId(origin: string, vaultId: string): string {
  return `daemon:${origin}#${vaultId}`
}

export function parseDaemonSourceId(
  id: string
): { origin: string; vaultId: string } | null {
  if (!id.startsWith("daemon:")) return null
  const rest = id.slice("daemon:".length)
  // An empty origin (the served app's same-origin daemon) puts the `#` first,
  // so `hash === 0` is valid; only a missing separator or an empty vault is not.
  const hash = rest.lastIndexOf("#")
  if (hash < 0 || hash === rest.length - 1) return null
  return { origin: rest.slice(0, hash), vaultId: rest.slice(hash + 1) }
}

/** One entry of the persisted source map. */
export interface SourceEntry {
  enabled: boolean
  /**
   * Optional display label chosen for this browser profile. It never changes
   * the Browser collection, daemon Vault id, or daemon-provided Vault name.
   */
  label?: string
  /**
   * Standalone only: this profile used Standalone before the sunset, so it
   * keeps access for the sunset period. New profiles never see this flag.
   */
  legacy?: boolean
  /** Daemon only: the connection this source belongs to. */
  origin?: string
  /** Daemon only: the vault's id on that daemon. */
  vaultId?: string
  /** Daemon only: the vault's display name, refreshed by discovery. */
  name?: string
  /**
   * Daemon only: this connection's daemon predates Vault ids (its `/vaults`
   * route does not exist), so its one vault is reached through the legacy
   * unscoped routes. Discovery clears the flag the moment a daemon that
   * knows its vaults answers.
   */
  unscoped?: boolean
}

export interface SourceConfig {
  version: 2
  /**
   * Daemon connections this profile has connected, keyed by canonical
   * origin. A connection persists independently of whether its vaults are
   * enabled, so disabling a source never loses the address or token.
   */
  connections: Record<string, { bearerToken?: string }>
  sources: Record<string, SourceEntry>
  activeSourceId: string | null
}

export function emptySourceConfig(): SourceConfig {
  return { version: 2, connections: {}, sources: {}, activeSourceId: null }
}

/** The config a brand-new profile starts from on a given platform. */
export function initialSourceConfig(caps: PlatformCapabilities): SourceConfig {
  const config = emptySourceConfig()
  // Chrome and Firefox profiles start with Browser enabled and active. A
  // platform with no Browser Source (Safari, the daemon-served app) starts
  // with nothing: connecting a daemon is the only path in.
  if (caps.browserSource) {
    config.sources[BROWSER_SOURCE_ID] = { enabled: true }
    config.activeSourceId = BROWSER_SOURCE_ID
  }
  return config
}

/**
 * Deterministic display order for source ids: Browser, Standalone, then
 * daemon sources by origin then vault id. Config maps are unordered; every
 * list the UI shows goes through this so it never flickers between loads.
 */
export function orderSourceIds(ids: string[]): string[] {
  const rank = (id: string): number =>
    id === BROWSER_SOURCE_ID
      ? 0
      : id === STANDALONE_SOURCE_ID
        ? 1
        : parseDaemonSourceId(id)
          ? 2
          : 3
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** Enabled source ids in display order. */
export function enabledSourceIds(config: SourceConfig): string[] {
  return orderSourceIds(
    Object.entries(config.sources)
      .filter(([, entry]) => entry.enabled)
      .map(([id]) => id)
  )
}

/**
 * The config with its invariants repaired.
 *
 * - The active source must exist and be enabled; when it does not, the first
 *   enabled source in display order becomes active — deterministically, so
 *   two launches cannot disagree.
 * - A platform without a Browser Source (Safari) never gains one, whatever
 *   an old config claims.
 * - Standalone disappears entirely once nothing marks it legacy: it is not
 *   an ordinary selectable source.
 */
export function normalizeSourceConfig(
  config: SourceConfig,
  caps: PlatformCapabilities
): SourceConfig {
  const sources: Record<string, SourceEntry> = {}

  for (const [id, entry] of Object.entries(config.sources)) {
    if (id === STANDALONE_SOURCE_ID && !entry.legacy) {
      // Not a legacy profile: the sunset means it is gone for good.
      continue
    }
    if (id === BROWSER_SOURCE_ID && !caps.browserSource) {
      // Safari and the daemon-served app have no Browser Source to enable.
      continue
    }
    if (
      id === STANDALONE_SOURCE_ID &&
      !caps.browserSource &&
      !caps.isExtension
    ) {
      // The standalone collection only ever existed as an extension/web
      // fallback; the daemon-served app has no IndexedDB profile for it.
      continue
    }
    sources[id] = { ...entry }
  }

  const normalized: SourceConfig = {
    version: 2,
    connections: { ...config.connections },
    sources,
    activeSourceId: config.activeSourceId,
  }

  const enabled = enabledSourceIds(normalized)
  const active =
    normalized.activeSourceId && enabled.includes(normalized.activeSourceId)
      ? normalized.activeSourceId
      : (enabled[0] ?? null)
  normalized.activeSourceId = active

  return normalized
}

/**
 * Disables a source, retaining its configuration.
 *
 * Refuses (returns `null`) when it is the only enabled source: at least one
 * usable source must remain. Disabling is never destructive — a disabled
 * daemon source keeps its connection, and Standalone keeps its data.
 */
export function disableSource(
  config: SourceConfig,
  id: string
): SourceConfig | null {
  const entry = config.sources[id]
  if (!entry?.enabled) return null
  const others = enabledSourceIds(config).filter((other) => other !== id)
  if (others.length === 0) return null

  const next: SourceConfig = {
    ...config,
    sources: { ...config.sources, [id]: { ...entry, enabled: false } },
  }
  if (next.activeSourceId === id) {
    next.activeSourceId = others[0]
  }
  return next
}

/** Enables a source, retaining its configuration. Never refuses. */
export function enableSource(config: SourceConfig, id: string): SourceConfig {
  const entry = config.sources[id]
  if (!entry) return config
  return {
    ...config,
    sources: { ...config.sources, [id]: { ...entry, enabled: true } },
  }
}

/**
 * Makes an enabled source the Active Source.
 *
 * Returns `null` when the source does not exist or is disabled: the active
 * source is always one of the enabled ones, and a failed click must not
 * silently activate something else.
 */
export function setActiveSource(
  config: SourceConfig,
  id: string
): SourceConfig | null {
  const entry = config.sources[id]
  if (!entry?.enabled) return null
  return { ...config, activeSourceId: id }
}

/**
 * Sets a profile-local display label without changing the source's identity.
 * Whitespace-only labels restore the source's default label.
 */
export function setSourceLabel(
  config: SourceConfig,
  id: string,
  label: string
): SourceConfig {
  const entry = config.sources[id]
  if (!entry) return config

  const trimmed = label.trim()
  const nextEntry: SourceEntry = { ...entry }
  if (trimmed) nextEntry.label = trimmed
  else delete nextEntry.label

  return {
    ...config,
    sources: { ...config.sources, [id]: nextEntry },
  }
}

/** Upserts a discovered daemon vault as a source. */
export function upsertDaemonSource(
  config: SourceConfig,
  origin: string,
  vault: { id: string; name?: string },
  options: { enabled?: boolean; unscoped?: boolean } = {}
): SourceConfig {
  const id = daemonSourceId(origin, vault.id)
  const existing = config.sources[id]
  const enabled = options.enabled ?? existing?.enabled ?? true
  // An explicit answer wins: discovery always gives one, and "this daemon
  // turned out to know its vaults" must clear a flag an older reading set.
  const unscoped =
    options.unscoped !== undefined
      ? options.unscoped
      : (existing?.unscoped ?? false)
  return {
    ...config,
    sources: {
      ...config.sources,
      [id]: {
        enabled,
        ...(existing?.label ? { label: existing.label } : {}),
        origin,
        vaultId: vault.id,
        ...(vault.name ? { name: vault.name } : {}),
        ...(unscoped ? { unscoped: true } : {}),
      },
    },
  }
}

/**
 * Removes a source entry outright (not disable): used when discovery shows a
 * vault no longer hosted. If it was active, the next enabled source becomes
 * active. Unlike forget, the connection is kept — the daemon may host the
 * vault again after a restart.
 */
export function removeSource(config: SourceConfig, id: string): SourceConfig {
  const sources = { ...config.sources }
  delete sources[id]
  const next: SourceConfig = { ...config, sources }
  if (next.activeSourceId === id) {
    next.activeSourceId = enabledSourceIds(next)[0] ?? null
  }
  return next
}

/**
 * Forgets a daemon connection and everything hanging off it: the origin,
 * any bearer token, and every vault source it provided. Sources from other
 * connections are untouched. If the active source was forgotten, the next
 * enabled source becomes active.
 */
export function forgetDaemonConnection(
  config: SourceConfig,
  origin: string
): SourceConfig {
  const connections = { ...config.connections }
  delete connections[origin]

  const sources: Record<string, SourceEntry> = {}
  for (const [id, entry] of Object.entries(config.sources)) {
    if (parseDaemonSourceId(id)?.origin === origin) continue
    sources[id] = entry
  }

  const next: SourceConfig = { ...config, connections, sources }
  if (next.activeSourceId && !next.sources[next.activeSourceId]?.enabled) {
    next.activeSourceId = enabledSourceIds(next)[0] ?? null
  }
  return next
}

/**
 * Migration input from version 1: what the profile stored before sources
 * existed as a set.
 */
export interface LegacyAdapterState {
  /** The old scalar preference: "browser" | "standalone" | "daemon" | null. */
  adapterMode: string | null
  /** The one daemon connection v1 could store, when it had one. */
  daemonConnection: { origin: string; bearerToken?: string } | null
}

/**
 * Builds the v2 document a v1 profile migrates to.
 *
 * - `browser` and `standalone` profiles keep exactly the source they were
 *   using. Standalone is marked legacy so the sunset keeps it selectable for
 *   this profile alone; browser profiles also stay exactly as they were.
 * - A `daemon` profile keeps the daemon source enabled and *active* even
 *   though the vault id is not known yet (`LEGACY_VAULT_ID` stands in until
 *   discovery refreshes it): an unreachable daemon must surface as an error
 *   against the source the user chose, never as a silent switch to a
 *   different set of bookmarks.
 * - Browser is additionally enabled for daemon profiles, matching how a
 *   fresh connect behaves: connecting a daemon enables its vault sources
 *   without disabling Browser.
 */
export function migrateFromAdapterMode(
  legacy: LegacyAdapterState,
  caps: PlatformCapabilities
): SourceConfig {
  const config = initialSourceConfig(caps)

  if (legacy.daemonConnection) {
    config.connections[legacy.daemonConnection.origin] = {
      ...(legacy.daemonConnection.bearerToken
        ? { bearerToken: legacy.daemonConnection.bearerToken }
        : {}),
    }
  }

  switch (legacy.adapterMode) {
    case "standalone":
      config.sources[STANDALONE_SOURCE_ID] = { enabled: true, legacy: true }
      config.activeSourceId = STANDALONE_SOURCE_ID
      break
    case "daemon":
      if (legacy.daemonConnection) {
        const id = daemonSourceId(
          legacy.daemonConnection.origin,
          LEGACY_VAULT_ID
        )
        config.sources[id] = {
          enabled: true,
          origin: legacy.daemonConnection.origin,
          vaultId: LEGACY_VAULT_ID,
          // The daemon this profile last talked to predates Vault ids (or,
          // at best, has not been asked yet); the unscoped routes work either
          // way while exactly one Vault is hosted, which is the only shape a
          // pre-migration profile can have been using.
          unscoped: true,
        }
        config.activeSourceId = id
      }
      break
    // "browser" and null: the initial config already says it.
    default:
      break
  }

  return normalizeSourceConfig(config, caps)
}
