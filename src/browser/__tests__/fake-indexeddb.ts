import { IDBFactory } from "fake-indexeddb"

/**
 * Installs a fresh in-memory IndexedDB (backed by the spec-compliant
 * `fake-indexeddb` package) as `globalThis.indexedDB`.
 *
 * A hand-rolled fake was tried here first, but it didn't model transaction
 * completion (`tx.oncomplete`/`onerror`) at all, so any write path relying
 * on it — like the standalone bookmark adapter's seed write — would hang
 * forever instead of resolving. Call this again between tests to reset all
 * databases; a new IDBFactory shares nothing with the previous one.
 */
export function installFakeIndexedDB() {
  globalThis.indexedDB = new IDBFactory()
}
