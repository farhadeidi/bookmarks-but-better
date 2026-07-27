/**
 * Persists the user's chosen adapter mode ("browser" vs "standalone") to a
 * fixed IndexedDB location that exists independently of any BrowserAdapter.
 *
 * `detectAdapter` has to read this preference *before* it can construct an
 * adapter, so the preference cannot live behind `StorageAdapter.get/set` —
 * whichever adapter happens to be active would write it somewhere different
 * (chrome.storage.local vs this IndexedDB store), and the next launch would
 * read from the wrong place. This module is the single read/write path so
 * switching between browser and standalone persists correctly either way.
 */

const DB_NAME = "bookmarks-but-better-prefs"
const DB_VERSION = 1
const STORE_NAME = "preferences"
const ADAPTER_PREF_KEY = "adapterMode"

export type AdapterMode = "browser" | "standalone"

function openPreferenceDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function getAdapterModePreference(): Promise<AdapterMode | null> {
  try {
    const db = await openPreferenceDB()
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(ADAPTER_PREF_KEY)
      request.onsuccess = () => {
        const value = request.result
        resolve(value === "browser" || value === "standalone" ? value : null)
      }
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function setAdapterModePreference(
  mode: AdapterMode
): Promise<void> {
  try {
    const db = await openPreferenceDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      const request = store.put(mode, ADAPTER_PREF_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch {
    // Best-effort: if IndexedDB is unavailable the preference just won't
    // persist across launches.
  }
}
