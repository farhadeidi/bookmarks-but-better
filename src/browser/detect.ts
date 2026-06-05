import type { BrowserAdapter } from "./types"
import { ChromeBookmarkAdapter } from "./chrome/bookmarks"
import { ChromeStorageAdapter } from "./chrome/storage"
import { ChromeFaviconAdapter } from "./chrome/favicon"
import { FirefoxBookmarkAdapter } from "./firefox/bookmarks"
import { FirefoxStorageAdapter } from "./firefox/storage"
import { FirefoxFaviconAdapter } from "./firefox/favicon"
import { StandaloneBookmarkAdapter } from "./standalone/bookmarks"
import { StandaloneStorageAdapter } from "./standalone/storage"
import { StandaloneFaviconAdapter } from "./standalone/favicon"

const ADAPTER_PREF_KEY = "adapterMode"
const SYNC_MIGRATION_FLAG = "__syncToLocalMigrated"

/**
 * One-time migration of preferences from chrome.storage.sync to
 * chrome.storage.local. Preferences used to sync across devices, but the
 * stored `rootFolderId` is a browser-assigned bookmark node id that is local
 * to each profile/OS, so syncing it broke the root folder on other machines.
 *
 * Copies all existing sync keys (including rootFolderId) into local once, then
 * sets a flag so it never runs again. Sync storage is intentionally left
 * untouched so devices that haven't updated yet keep reading their settings.
 */
async function migrateSyncToLocal(): Promise<void> {
  try {
    const flag = await chrome.storage.local.get(SYNC_MIGRATION_FLAG)
    if (flag[SYNC_MIGRATION_FLAG]) return

    const synced = await chrome.storage.sync.get(null)
    if (Object.keys(synced).length > 0) {
      await chrome.storage.local.set(synced)
    }
    await chrome.storage.local.set({ [SYNC_MIGRATION_FLAG]: true })
  } catch {
    // Best-effort: if sync storage is unavailable there is nothing to migrate.
  }
}

function isBrowserExtension(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      typeof chrome.bookmarks !== "undefined" &&
      typeof chrome.storage !== "undefined"
    )
  } catch {
    return false
  }
}

function isFirefoxBuild(): boolean {
  return import.meta.env.VITE_BUILD_TARGET === "firefox"
}

async function getUserAdapterPreference(): Promise<
  "browser" | "standalone" | null
> {
  return new Promise((resolve) => {
    const request = indexedDB.open("bookmarks-but-better-prefs", 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains("preferences")) {
        db.createObjectStore("preferences")
      }
    }
    request.onsuccess = () => {
      const db = request.result
      try {
        const tx = db.transaction("preferences", "readonly")
        const store = tx.objectStore("preferences")
        const getReq = store.get(ADAPTER_PREF_KEY)
        getReq.onsuccess = () => {
          const value = getReq.result
          if (value === "browser" || value === "standalone") {
            resolve(value)
          } else {
            resolve(null)
          }
        }
        getReq.onerror = () => resolve(null)
      } catch {
        resolve(null)
      }
    }
    request.onerror = () => resolve(null)
  })
}

function createChromeAdapter(): BrowserAdapter {
  return {
    bookmarks: new ChromeBookmarkAdapter(),
    storage: new ChromeStorageAdapter(),
    favicon: new ChromeFaviconAdapter(),
    capabilities: {
      openInManager: true,
    },
  }
}

function createFirefoxAdapter(): BrowserAdapter {
  return {
    bookmarks: new FirefoxBookmarkAdapter(),
    storage: new FirefoxStorageAdapter(),
    favicon: new FirefoxFaviconAdapter(),
    capabilities: {
      openInManager: false,
    },
  }
}

function createStandaloneAdapter(): BrowserAdapter {
  return {
    bookmarks: new StandaloneBookmarkAdapter(),
    storage: new StandaloneStorageAdapter(),
    favicon: new StandaloneFaviconAdapter(),
    capabilities: {
      openInManager: false,
    },
  }
}

export async function detectAdapter(): Promise<BrowserAdapter> {
  const preference = await getUserAdapterPreference()

  if (preference === "standalone") {
    return createStandaloneAdapter()
  }

  if (isFirefoxBuild() && isBrowserExtension()) {
    await migrateSyncToLocal()
    return createFirefoxAdapter()
  }

  if (preference === "browser" && isBrowserExtension()) {
    await migrateSyncToLocal()
    return createChromeAdapter()
  }

  if (isBrowserExtension()) {
    await migrateSyncToLocal()
    return createChromeAdapter()
  }

  return createStandaloneAdapter()
}
