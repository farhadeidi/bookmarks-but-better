import { vi } from "vitest"

/**
 * Minimal in-memory stand-in for the narrow slice of IndexedDB this codebase
 * uses (single object store per DB, optional keyPath + one index, get/put/
 * delete/getAll, no cursors or key ranges). Persists per DB name across
 * separate `indexedDB.open()` calls within a test, matching real IndexedDB's
 * durability semantics closely enough to exercise round-trip reads/writes.
 */
export function installFakeIndexedDB() {
  const databases = new Map<string, FakeDatabase>()

  class FakeRequest {
    result: unknown
    error: unknown = null
    onsuccess: (() => void) | null = null
    onerror: (() => void) | null = null
  }

  class FakeOpenRequest extends FakeRequest {
    onupgradeneeded: (() => void) | null = null
  }

  class FakeIndex {
    constructor(
      private records: Map<IDBValidKey, Record<string, unknown>>,
      private keyPath: string
    ) {}

    getAll(value: unknown) {
      const req = new FakeRequest()
      queueMicrotask(() => {
        req.result = [...this.records.values()].filter(
          (record) => record[this.keyPath] === value
        )
        req.onsuccess?.()
      })
      return req
    }
  }

  class FakeObjectStore {
    private indexes = new Map<string, FakeIndex>()

    constructor(
      private records: Map<IDBValidKey, Record<string, unknown>>,
      private keyPath?: string
    ) {}

    createIndex(name: string, keyPath: string) {
      this.indexes.set(name, new FakeIndex(this.records, keyPath))
    }

    index(name: string) {
      const index = this.indexes.get(name)
      if (!index) throw new Error(`Unknown index: ${name}`)
      return index
    }

    get(key: IDBValidKey) {
      const req = new FakeRequest()
      queueMicrotask(() => {
        req.result = this.records.get(key)
        req.onsuccess?.()
      })
      return req
    }

    getAll() {
      const req = new FakeRequest()
      queueMicrotask(() => {
        req.result = [...this.records.values()]
        req.onsuccess?.()
      })
      return req
    }

    put(value: Record<string, unknown>, key?: IDBValidKey) {
      const req = new FakeRequest()
      const resolvedKey =
        key ?? (this.keyPath ? (value[this.keyPath] as IDBValidKey) : undefined)
      if (resolvedKey === undefined) {
        throw new Error("No key supplied and store has no keyPath")
      }
      this.records.set(resolvedKey, value)
      queueMicrotask(() => {
        req.result = resolvedKey
        req.onsuccess?.()
      })
      return req
    }

    delete(key: IDBValidKey) {
      const req = new FakeRequest()
      this.records.delete(key)
      queueMicrotask(() => req.onsuccess?.())
      return req
    }
  }

  class FakeTransaction {
    constructor(private db: FakeDatabase) {}

    objectStore(name: string) {
      const store = this.db.stores.get(name)
      if (!store) throw new Error(`Unknown object store: ${name}`)
      return store
    }
  }

  class FakeDatabase {
    stores = new Map<string, FakeObjectStore>()
    private recordsByStore = new Map<
      string,
      Map<IDBValidKey, Record<string, unknown>>
    >()

    get objectStoreNames() {
      const names = [...this.stores.keys()]
      return { contains: (name: string) => names.includes(name) }
    }

    createObjectStore(name: string, options?: { keyPath?: string }) {
      const records = new Map<IDBValidKey, Record<string, unknown>>()
      this.recordsByStore.set(name, records)
      const store = new FakeObjectStore(records, options?.keyPath)
      this.stores.set(name, store)
      return store
    }

    transaction(name: string) {
      void name
      return new FakeTransaction(this)
    }
  }

  const fakeIndexedDB = {
    open(name: string) {
      const req = new FakeOpenRequest()
      const isNew = !databases.has(name)
      if (isNew) databases.set(name, new FakeDatabase())
      const db = databases.get(name)!
      req.result = db
      queueMicrotask(() => {
        if (isNew) req.onupgradeneeded?.()
        req.onsuccess?.()
      })
      return req
    },
  }

  vi.stubGlobal("indexedDB", fakeIndexedDB)

  return {
    reset() {
      databases.clear()
    },
  }
}
