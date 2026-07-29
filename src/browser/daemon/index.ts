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
      move: true,
      // Stays false: `move(id, {index})` is the only path the grid, the
      // folder cards and the DndMonitor have, and the daemon's move endpoint
      // ignores the index. Ordering is a separate capability below.
      reorder: false,
      setChildOrder: true,
    },
  }
}

export { DaemonBookmarkAdapter } from "./bookmarks"
export { DaemonFaviconAdapter, localFaviconDataUri } from "./favicon"
export { connectDaemonEvents } from "./sse"
