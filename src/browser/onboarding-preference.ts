/**
 * Adapter-independent onboarding state.
 *
 * The active adapter can change between Browser, Standalone and Daemon, but
 * completing product onboarding is a property of this extension profile, not
 * of a bookmark source. Keeping it in the same fixed IndexedDB store as the
 * adapter-routing preference makes it survive source changes.
 *
 * Older releases stored `onboardingCompleted` behind the active
 * StorageAdapter. Bootstrap migrates that value into this key on first use and
 * the wizard continues writing the legacy key for downgrade compatibility.
 */

const DB_NAME = "bookmarks-but-better-prefs"
const DB_VERSION = 1
const STORE_NAME = "preferences"
const ONBOARDING_COMPLETED_KEY = "bookmarks-but-better.onboardingCompleted"

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

export async function getOnboardingCompleted(): Promise<boolean | null> {
  try {
    const db = await openPreferenceDB()
    return await new Promise<boolean | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const request = tx.objectStore(STORE_NAME).get(ONBOARDING_COMPLETED_KEY)
      request.onsuccess = () =>
        resolve(typeof request.result === "boolean" ? request.result : null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function setOnboardingCompleted(value: boolean): Promise<void> {
  try {
    const db = await openPreferenceDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx
        .objectStore(STORE_NAME)
        .put(value, ONBOARDING_COMPLETED_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
    })
  } catch {
    // Best-effort, matching the adapter preference persistence contract.
  }
}
