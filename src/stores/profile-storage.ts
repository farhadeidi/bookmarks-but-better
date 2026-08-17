/**
 * Profile-wide preferences: the fixed IndexedDB namespace that survives
 * source switches and belongs to this browser profile alone.
 *
 * Preferences split into two lifetimes. Profile-wide ones — light/dark, color
 * theme, max columns, container width, nested folders — describe the person
 * and the screen, so they live here, independent of which source is active.
 * Source-scoped ones — the chosen root folder, per-folder layouts and order —
 * key off node ids that only mean something inside one source, so they live
 * behind the active source's `StorageAdapter` instead.
 *
 * Reads fall back to the active adapter's storage once: these keys used to be
 * written wherever the then-active adapter put them, and a profile upgrading
 * through the source refactor must not look like it forgot its theme. Writes
 * only ever land here, so the fallback is read at most until the user touches
 * the setting.
 */

import type { StorageAdapter } from "@/browser/types"

const DB_NAME = "bookmarks-but-better-prefs"
const DB_VERSION = 1
const STORE_NAME = "preferences"
const NAMESPACE = "bookmarks-but-better.profile."

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

export class ProfileStorageAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null

  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDB()
    }
    return this.db
  }

  private key(id: string): string {
    return `${NAMESPACE}${id}`
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const request = tx.objectStore(STORE_NAME).get(this.key(key))
      request.onsuccess = () => {
        resolve(request.result !== undefined ? (request.result as T) : null)
      }
      request.onerror = () => reject(request.error)
    })
  }

  async set<T>(key: string, value: T): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx.objectStore(STORE_NAME).put(value, this.key(key))
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async remove(key: string): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx.objectStore(STORE_NAME).delete(this.key(key))
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}

/**
 * Reads a profile-wide preference, falling back to where the active source's
 * adapter would have stored it before the split.
 *
 * A fallback hit is written through to the profile namespace, so the legacy
 * location is consulted at most once per key: after that the profile owns
 * the value, whatever any single source's storage later claims.
 */
export async function readProfilePreference<T>(
  key: string,
  source: StorageAdapter
): Promise<T | null> {
  const profile = new ProfileStorageAdapter()
  const value = await profile.get<T>(key)
  if (value !== null) return value

  const legacy = await source.get<T>(key)
  if (legacy !== null) {
    await profile.set(key, legacy)
  }
  return legacy
}
