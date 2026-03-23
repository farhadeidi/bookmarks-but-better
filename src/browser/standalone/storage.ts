import type { StorageAdapter } from "../types"

const DB_NAME = "bookmarks-but-better-prefs"
const DB_VERSION = 1
const STORE_NAME = "preferences"

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

export class StandaloneStorageAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null

  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDB()
    }
    return this.db
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const store = tx.objectStore(STORE_NAME)
      const request = store.get(key)
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
      const store = tx.objectStore(STORE_NAME)
      const request = store.put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async remove(key: string): Promise<void> {
    const db = await this.getDB()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      const request = store.delete(key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
