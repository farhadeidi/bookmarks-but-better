/**
 * UI preferences for daemon mode (served or extension), namespaced away from
 * Standalone's.
 *
 * Before this module existed, daemon mode reused `StandaloneStorageAdapter`
 * outright: same IndexedDB database, same object store, same unprefixed keys
 * (`rootFolderId`, `cardLayouts`, `colorTheme`, …). That is harmless for the
 * daemon-served build, which never shares a browser profile with Standalone
 * mode — but the *extension* can switch a single profile between Standalone
 * and an extension-daemon connection, and both would then read and write the
 * exact same `rootFolderId`. A vault's root folder id and Standalone's are
 * different ids entirely, so switching modes could silently display the
 * wrong root folder, or overwrite one mode's saved layout with the other's.
 *
 * Every key here therefore lives under `bookmarks-but-better.daemon.ui.`, the same top-level
 * namespace `adapter-preference.ts` already uses for the connection config —
 * so the two modules' keys stay legible as belonging together without ever
 * colliding with each other or with Standalone's.
 */

import type { StorageAdapter } from "../types"
import { ADAPTER_PREF_KEY } from "../adapter-preference"

const DB_NAME = "bookmarks-but-better-prefs"
const DB_VERSION = 1
const STORE_NAME = "preferences"

const NAMESPACE = "bookmarks-but-better.daemon.ui."
const LEGACY_MIGRATION_FLAG = `${NAMESPACE}migratedLegacyKeys`
/** Nothing under this prefix is a legacy UI preference — it is this module's
 * own namespace, or `adapter-preference.ts`'s. */
const OWNED_PREFIX = "bookmarks-but-better.daemon."

function openDB(): Promise<IDBDatabase> {
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

/**
 * Copies every pre-existing unprefixed key into this namespace, once, ever.
 *
 * A profile that ran only in daemon mode before this namespace existed has
 * real preferences — a chosen root folder, a layout — sitting at the
 * unprefixed keys. Losing them on upgrade would look exactly like the app
 * forgetting the user's settings, so they are copied forward rather than
 * abandoned.
 *
 * The copy is deliberately one-directional and additive: originals are never
 * deleted, so if a key actually belonged to Standalone all along (the two
 * modes were both used in this profile), Standalone keeps reading it from the
 * unprefixed key exactly as before — this migration cannot take anything away
 * from it, only give the daemon its own copy to start from. Gated by a
 * persisted flag so it runs exactly once across every future launch, in every
 * mode, forever after.
 *
 * Best-effort throughout, like the rest of this file's IndexedDB access: a
 * failure here means daemon mode starts from empty preferences rather than
 * migrated ones, never a thrown error the caller has to handle.
 */
function migrateLegacyKeysOnce(db: IDBDatabase): Promise<void> {
  return new Promise((resolve) => {
    const checkTx = db.transaction(STORE_NAME, "readonly")
    const flagRequest = checkTx
      .objectStore(STORE_NAME)
      .get(LEGACY_MIGRATION_FLAG)

    flagRequest.onsuccess = () => {
      if (flagRequest.result === true) {
        resolve()
        return
      }

      const entries: Array<[string, unknown]> = []
      const cursorTx = db.transaction(STORE_NAME, "readonly")
      const cursorRequest = cursorTx.objectStore(STORE_NAME).openCursor()

      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result
        if (cursor) {
          const key = cursor.key
          if (
            typeof key === "string" &&
            !key.startsWith(OWNED_PREFIX) &&
            key !== ADAPTER_PREF_KEY
          ) {
            entries.push([key, cursor.value])
          }
          cursor.continue()
          return
        }

        const writeTx = db.transaction(STORE_NAME, "readwrite")
        const store = writeTx.objectStore(STORE_NAME)
        for (const [key, value] of entries) {
          store.put(value, `${NAMESPACE}${key}`)
        }
        store.put(true, LEGACY_MIGRATION_FLAG)
        writeTx.oncomplete = () => resolve()
        writeTx.onerror = () => resolve()
      }
      cursorRequest.onerror = () => resolve()
    }
    flagRequest.onerror = () => resolve()
  })
}

export class DaemonStorageAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null
  private migrated: Promise<void> | null = null

  private async ready(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDB()
    }
    // Persisted behind `LEGACY_MIGRATION_FLAG`, so every instance after the
    // very first one this profile ever creates resolves this immediately.
    this.migrated ??= migrateLegacyKeysOnce(this.db)
    await this.migrated
    return this.db
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.ready()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const request = tx.objectStore(STORE_NAME).get(`${NAMESPACE}${key}`)
      request.onsuccess = () => {
        resolve(request.result !== undefined ? (request.result as T) : null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = await this.ready()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx
        .objectStore(STORE_NAME)
        .put(value, `${NAMESPACE}${key}`)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async remove(key: string): Promise<void> {
    const db = await this.ready()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx.objectStore(STORE_NAME).delete(`${NAMESPACE}${key}`)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
