import type { BrowserAdapter } from "./types"
import { ChromeBookmarkAdapter } from "./chrome/bookmarks"
import { ChromeStorageAdapter } from "./chrome/storage"
import { ChromeFaviconAdapter } from "./chrome/favicon"
import { StandaloneBookmarkAdapter } from "./standalone/bookmarks"
import { StandaloneStorageAdapter } from "./standalone/storage"
import { StandaloneFaviconAdapter } from "./standalone/favicon"

const ADAPTER_PREF_KEY = "adapter-mode"

function isChromeExtension(): boolean {
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
  }
}

function createStandaloneAdapter(): BrowserAdapter {
  return {
    bookmarks: new StandaloneBookmarkAdapter(),
    storage: new StandaloneStorageAdapter(),
    favicon: new StandaloneFaviconAdapter(),
  }
}

export async function detectAdapter(): Promise<BrowserAdapter> {
  const preference = await getUserAdapterPreference()

  if (preference === "standalone") {
    return createStandaloneAdapter()
  }

  if (preference === "browser" && isChromeExtension()) {
    return createChromeAdapter()
  }

  if (isChromeExtension()) {
    return createChromeAdapter()
  }

  return createStandaloneAdapter()
}
