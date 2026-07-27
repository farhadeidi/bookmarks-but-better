import type { BrowserAdapter } from "../types"
import { StandaloneStorageAdapter } from "../standalone/storage"
import { DaemonBookmarkAdapter } from "./bookmarks"
import { DaemonFaviconAdapter } from "./favicon"

export function createDaemonAdapter(): BrowserAdapter {
  return {
    bookmarks: new DaemonBookmarkAdapter(),
    // UI preferences stay client-local in IndexedDB regardless of adapter;
    // the daemon config only holds operational settings.
    storage: new StandaloneStorageAdapter(),
    favicon: new DaemonFaviconAdapter(),
    capabilities: {
      openInManager: false,
      reorder: false,
    },
  }
}

export { DaemonBookmarkAdapter } from "./bookmarks"
export { DaemonFaviconAdapter } from "./favicon"
export { localFaviconDataUri } from "./favicon"
export { connectDaemonEvents } from "./sse"
export {
  DaemonApiError,
  fetchHealth,
  triggerRescan,
  DAEMON_EVENTS_PATH,
} from "./client"
