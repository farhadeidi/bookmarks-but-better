import type { BrowserAdapter, DaemonConnectionConfig } from "../types"
import { StandaloneStorageAdapter } from "../standalone/storage"
import { DaemonBookmarkAdapter } from "./bookmarks"
import { DaemonClient, createSameOriginDaemonClient } from "./client"
import { DaemonFaviconAdapter } from "./favicon"

/**
 * The capabilities are a property of the *daemon*, not of how it was reached,
 * so served and extension modes share them exactly. If they ever diverge, the
 * two factories below are where the divergence belongs — not a runtime check.
 */
function daemonAdapterFor(client: DaemonClient): BrowserAdapter {
  return {
    bookmarks: new DaemonBookmarkAdapter({ client }),
    // UI preferences stay client-local in IndexedDB regardless of adapter;
    // the daemon config only holds operational settings.
    storage: new StandaloneStorageAdapter(),
    favicon: new DaemonFaviconAdapter(),
    capabilities: {
      openInManager: false,
      move: true,
      // Stays false: `move(id, {index})` is the only path the grid, the
      // folder cards and the DndMonitor have, and the daemon's move endpoint
      // ignores the index. Ordering is a separate capability below.
      reorder: false,
      setChildOrder: true,
    },
  }
}

/**
 * The daemon-serving-its-own-UI mode: same origin, no configuration.
 *
 * This is what `VITE_BUILD_TARGET=daemon` builds and what has always existed.
 * There is nothing to configure and nothing to get wrong — the page was served
 * by the daemon it talks to — so it deliberately takes no arguments.
 */
export function createServedDaemonAdapter(): BrowserAdapter {
  return daemonAdapterFor(createSameOriginDaemonClient())
}

/**
 * The extension mode: an absolute loopback origin, optionally authenticated.
 *
 * `config.origin` must already be canonical — the caller gets one from
 * `canonicalizeDaemonOrigin`, and nothing stores a raw user string — so this
 * does not re-validate and cannot silently accept a LAN address that slipped
 * past the settings form.
 */
export function createExtensionDaemonAdapter(
  config: DaemonConnectionConfig
): BrowserAdapter {
  return daemonAdapterFor(
    new DaemonClient({
      origin: config.origin,
      bearerToken: config.bearerToken,
    })
  )
}

/**
 * @deprecated Prefer the explicit {@link createServedDaemonAdapter}. Kept so
 * that anything still importing the original name keeps building the
 * same-origin adapter it always did.
 */
export function createDaemonAdapter(): BrowserAdapter {
  return createServedDaemonAdapter()
}

export { DaemonBookmarkAdapter } from "./bookmarks"
export { DaemonFaviconAdapter } from "./favicon"
export { connectDaemonEvents, createSseParser } from "./sse"
export {
  DaemonApiError,
  DaemonClient,
  createSameOriginDaemonClient,
} from "./client"
export {
  DEFAULT_DAEMON_ORIGIN,
  DEFAULT_DAEMON_PORT,
  DaemonEndpointError,
  canonicalizeDaemonOrigin,
  tryCanonicalizeDaemonOrigin,
} from "./endpoint"
