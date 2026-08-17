/**
 * The source store: Source Configuration plus the Active Source, and the one
 * place a source switch is allowed to happen.
 *
 * Switching is an explicit **Source Session transition**, not per-call
 * routing: the previous session's listeners and SSE stream are disposed, work
 * still in flight is expired against a session token, node-bound UI is
 * closed, the bookmark and preferences stores are re-initialized against the
 * new concrete adapter, and the selection is persisted. While a switch is in
 * progress no second switch starts — a click that lands mid-transition is
 * dropped rather than raced.
 *
 * Everything environment-specific — capabilities, adapter construction,
 * daemon connect and discovery, releasing daemon access — belongs to the
 * SourceEnvironment seam (`src/sources/environment.ts`); this store only
 * orchestrates configuration and sessions against it.
 *
 * There is deliberately no fallback when the active source is unreachable:
 * the source stays selected, the bookmark store reports why it cannot load,
 * and recovery is an explicit user action (retry, or switch elsewhere).
 */

import { create } from "zustand"
import type { BrowserAdapter } from "@/browser"
import { useBookmarkStore } from "@/stores/bookmark-store"
import { usePreferencesStore } from "@/stores/preferences-store"
import { useUIStore } from "@/stores/ui-store"
import type {
  DaemonConnectOptions,
  DaemonConnectResult,
} from "@/browser/daemon"
import { loadSourceConfig, saveSourceConfig } from "@/sources/persistence"
import {
  disableSource,
  enableSource,
  emptySourceConfig,
  enabledSourceIds,
  forgetDaemonConnection as forgetConnection,
  normalizeSourceConfig,
  orderSourceIds,
  removeSource,
  setActiveSource as withActive,
  setSourceLabel as withSourceLabel,
  upsertDaemonSource,
  type SourceConfig,
} from "@/sources/config"
import {
  resolveSourceEnvironment,
  type SourceEnvironment,
} from "@/sources/environment"
import { describeSource, type SourceDescriptor } from "@/sources/descriptors"

interface SourceState {
  /** `loading` until the persisted config has been read and normalized. */
  status: "loading" | "ready"
  config: SourceConfig
  activeSourceId: string | null
  /** True while a Source Session transition is in progress. */
  switching: boolean
  /** Why the most recent switch attempt was refused, if it was. */
  lastSwitchError: string | null

  initialize(): Promise<void>
  switchSource(id: string): Promise<void>
  /**
   * Enables or disables a source, retaining its configuration. Resolves
   * `false` when disabling was refused (it is the last enabled source).
   */
  setSourceEnabled(id: string, enabled: boolean): Promise<boolean>
  /** Changes only the profile-local display label; no session is restarted. */
  setSourceLabel(id: string, label: string): Promise<void>
  connectDaemon(
    originInput: string,
    options?: DaemonConnectOptions
  ): Promise<DaemonConnectResult>
  /** Forgets a daemon connection: sources, token and host permission. */
  forgetDaemon(origin: string): Promise<void>
  /** Re-runs discovery for one connection, or every connection when omitted. */
  refreshDaemonVaults(origin?: string): Promise<void>
}

/** Session token: bumped by every transition; stale async work checks it. */
let sessionToken = 0
/** The cleanup owned by the active session (listeners + adapter disposal). */
let activeCleanup: (() => void) | undefined
/**
 * The in-flight (or completed) initialization, so concurrent bootstrap
 * passes — a StrictMode double-invoke is exactly that — share one rather
 * than each starting its own session.
 */
let initializeInFlight: Promise<void> | null = null
/** The resolved environment; production everywhere except the Dev Workbench. */
let environment: SourceEnvironment | null = null

async function env(): Promise<SourceEnvironment> {
  environment ??= await resolveSourceEnvironment()
  return environment
}

/** Test seam: the current session's cleanup, for asserting disposal. */
export function activeSourceCleanup(): (() => void) | undefined {
  return activeCleanup
}

/** Test seam: reset the module-level session state between tests. */
export function resetSourceSession(): void {
  sessionToken = 0
  activeCleanup = undefined
  initializeInFlight = null
  environment = null
}

export const useSourceStore = create<SourceState>((set, get) => ({
  status: "loading",
  config: emptySourceConfig(),
  activeSourceId: null,
  switching: false,
  lastSwitchError: null,

  async initialize() {
    if (get().status === "ready") return
    // Single-flight: the first caller does the work; every concurrent caller
    // (and any later one, once complete) awaits the same result.
    initializeInFlight ??= performInitialize(set)
    await initializeInFlight
  },

  async switchSource(id) {
    const { config, switching } = get()
    if (switching) {
      set({ lastSwitchError: "Still switching to the previous source." })
      return
    }
    const next = withActive(config, id)
    if (!next) {
      set({ lastSwitchError: "That source is not enabled." })
      return
    }
    if (id === config.activeSourceId) return

    set({ switching: true, lastSwitchError: null, config: next })
    await saveSourceConfig(next)
    try {
      await transitionTo(id, next, set)
    } finally {
      set({ switching: false })
    }
  },

  async setSourceEnabled(id, enabled) {
    const { config } = get()
    if (!enabled) {
      const next = disableSource(config, id)
      if (!next) return false
      await saveSourceConfig(next)
      const activeChanged = next.activeSourceId !== config.activeSourceId
      set({ config: next, activeSourceId: next.activeSourceId })
      if (activeChanged) {
        if (next.activeSourceId) {
          await transitionTo(next.activeSourceId, next, set)
        } else {
          await teardownToEmpty()
        }
      }
      return true
    }

    const next = enableSource(config, id)
    await saveSourceConfig(next)
    set({ config: next })
    return true
  },

  async setSourceLabel(id, label) {
    const config = withSourceLabel(get().config, id, label)
    await saveSourceConfig(config)
    set({ config })
  },

  async connectDaemon(originInput, options = {}) {
    const e = await env()
    const result = await e.connect(originInput, options)
    if (!result.ok) return result

    let config = { ...get().config }
    config.connections[result.origin] = {
      ...(options.bearerToken ? { bearerToken: options.bearerToken } : {}),
    }
    for (const vault of result.vaults) {
      config = upsertDaemonSource(config, result.origin, vault, {
        enabled: true,
        unscoped: result.legacyProtocol,
      })
    }
    config = normalizeSourceConfig(config, e.capabilities())

    // Connecting switches to the first vault of the connection — matching
    // what Connect has always meant — without disabling anything else.
    const firstVault = result.vaults[0]
    if (firstVault) {
      const target = `daemon:${result.origin}#${firstVault.id}`
      config = withActive(config, target) ?? config
    }

    await saveSourceConfig(config)
    set({
      config,
      activeSourceId: config.activeSourceId,
    })
    if (config.activeSourceId) {
      await transitionTo(config.activeSourceId, config, set)
    }
    return result
  },

  async forgetDaemon(origin) {
    const e = await env()
    const before = get().config
    const config = normalizeSourceConfig(
      forgetConnection(before, origin),
      e.capabilities()
    )
    await saveSourceConfig(config)
    set({ config, activeSourceId: config.activeSourceId })
    // The loopback host permission is shared by every daemon connection (one
    // match pattern per host, any port), so it may only be released once the
    // last connection is gone — forgetting one of several must not cut the
    // others' reachability. Releasing is the environment's to do, best-effort
    // either way.
    if (Object.keys(config.connections).length === 0) {
      await e.releaseDaemonAccess()
    }

    if (config.activeSourceId !== before.activeSourceId) {
      if (config.activeSourceId) {
        await transitionTo(config.activeSourceId, config, set)
      } else {
        await teardownToEmpty()
      }
    }
  },

  async refreshDaemonVaults(origin) {
    const e = await env()
    const currentConfig = get().config
    const connections =
      origin === undefined
        ? currentConfig.connections
        : Object.hasOwn(currentConfig.connections, origin)
          ? { [origin]: currentConfig.connections[origin] }
          : {}
    const discoveries = await e.refreshDiscoveries(connections)
    let config = get().config
    for (const discovery of discoveries) {
      config = syncConnectionVaults(
        config,
        discovery.origin,
        discovery.vaults,
        discovery.legacyProtocol
      )
    }
    config = normalizeSourceConfig(config, e.capabilities())
    const activeChanged =
      config.activeSourceId !== get().config.activeSourceId ||
      sourcesDiffer(config, get().config)
    await saveSourceConfig(config)
    set({ config, activeSourceId: config.activeSourceId })
    if (activeChanged && config.activeSourceId) {
      if (config.activeSourceId !== get().activeSourceId) {
        await transitionTo(config.activeSourceId, config, set)
      }
    }
  },
}))

function sourcesDiffer(a: SourceConfig, b: SourceConfig): boolean {
  return JSON.stringify(a.sources) !== JSON.stringify(b.sources)
}

/**
 * Replaces one connection's vault sources with what discovery just reported,
 * preserving enabled state by vault id and moving the active source with its
 * vault when the id survived.
 */
function syncConnectionVaults(
  config: SourceConfig,
  origin: string,
  vaults: { id: string; name?: string }[],
  legacyProtocol: boolean
): SourceConfig {
  const discoveredIds = new Set(vaults.map((vault) => vault.id))
  let next = config

  // Drop sources whose vault is no longer hosted — the connection itself
  // stays, so a restart that brings the vault back restores it.
  for (const id of Object.keys(config.sources)) {
    const entry = config.sources[id]
    if (entry.origin !== origin) continue
    if (!discoveredIds.has(entry.vaultId ?? "")) {
      next = removeSource(next, id)
    }
  }

  for (const vault of vaults) {
    next = upsertDaemonSource(next, origin, vault, {
      unscoped: legacyProtocol,
    })
  }
  return next
}

async function performInitialize(
  set: (partial: Partial<SourceState>) => void
): Promise<void> {
  try {
    const e = await env()
    let config = await loadSourceConfig(e.capabilities())

    // The daemon-served app has no connections to configure: its daemon is
    // same-origin, and discovery is the only way it learns which Vaults
    // exist. Each hosted Vault becomes a source the app can switch among —
    // client-local, never a process-wide active Vault.
    if (e.discoveryAtStartup) {
      const discoveries = await e.refreshDiscoveries(config.connections)
      for (const discovery of discoveries) {
        config = syncConnectionVaults(
          config,
          discovery.origin,
          discovery.vaults,
          discovery.legacyProtocol
        )
      }
      config = normalizeSourceConfig(config, e.capabilities())
    }

    set({ status: "ready", config, activeSourceId: config.activeSourceId })

    if (config.activeSourceId) {
      await transitionTo(config.activeSourceId, config, set)
    }
  } finally {
    initializeInFlight = null
  }
}

/**
 * The Source Session transition itself.
 *
 * Order matters and is the whole contract:
 *
 * 1. Bump the session token — everything after this that awaits checks it,
 *    so work from a superseded transition cannot apply its results.
 * 2. Close node-bound UI: the organizer, editors and confirms hold node ids
 *    from the old source that mean nothing against the new one.
 * 3. Dispose the previous session: unsubscribe its listeners and tear down
 *    its adapter (which closes the SSE stream and its reconnect timers).
 * 4. Re-initialize the bookmark and preferences stores against the new
 *    concrete adapter.
 */
async function transitionTo(
  id: string,
  config: SourceConfig,
  set: (partial: Partial<SourceState>) => void
): Promise<void> {
  const token = ++sessionToken
  const isCurrent = () => token === sessionToken
  const descriptor = describeSource(id, config.sources[id])
  const adapter = await (await env()).adapterFor(descriptor, config.connections)

  closeNodeBoundUi()

  activeCleanup?.()
  activeCleanup = undefined

  const cleanup = await useBookmarkStore.getState().init(adapter, { isCurrent })
  if (!isCurrent()) {
    // A newer transition began while this one was initializing: this
    // session's subscriptions and stream never become live, and none of its
    // results were applied. The cleanup init returned is the single owner
    // of that disposal — it unsubscribes and disposes the adapter on every
    // path, including the superseded ones.
    cleanup?.()
    return
  }
  activeCleanup = cleanup ?? undefined
  set({ activeSourceId: id })

  await usePreferencesStore.getState().init(adapter, { isCurrent })
}

/** Tears the session down when no usable source remains. */
async function teardownToEmpty(): Promise<void> {
  const token = ++sessionToken
  closeNodeBoundUi()
  activeCleanup?.()
  activeCleanup = undefined
  if (token !== sessionToken) return
  await useBookmarkStore.getState().reset()
}

function closeNodeBoundUi(): void {
  const ui = useUIStore.getState()
  ui.closeBookmarkOrganizer()
  ui.closeEditor()
  ui.closeDeleteConfirm()
  ui.closeCreateItem()
}

/** Convenience selectors used across surfaces. */
export function activeSourceDescriptor(
  state: Pick<SourceState, "config" | "activeSourceId">
): SourceDescriptor | null {
  const { config, activeSourceId } = state
  if (!activeSourceId) return null
  const entry = config.sources[activeSourceId]
  if (!entry) return null
  return describeSource(activeSourceId, entry)
}

export function enabledSourceDescriptors(
  state: Pick<SourceState, "config">
): SourceDescriptor[] {
  return enabledSourceIds(state.config).map((id) =>
    describeSource(id, state.config.sources[id])
  )
}

export function allSourceDescriptors(
  state: Pick<SourceState, "config">
): SourceDescriptor[] {
  return orderSourceIds(Object.keys(state.config.sources)).map((id) =>
    describeSource(id, state.config.sources[id])
  )
}

/** Re-exported for the popup and omnibox, which read the active source. */
export type { BrowserAdapter }
