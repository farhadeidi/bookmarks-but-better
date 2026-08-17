/**
 * Persistence for the Dev Workbench's own state: the active scenario, its
 * failure controls, and the per-source data the simulated sources keep.
 *
 * Everything lives in a dedicated IndexedDB (`bookmarks-but-better-dev`) so a
 * scenario's data can be wiped deterministically without ever touching the
 * profile stores the application itself owns. The one exception is the
 * "applied scenario" stamp, which is written into the application's
 * preferences database next to the Source Configuration it explains: it is the
 * answer to "was this profile's source config written by this scenario at
 * this revision, or does it need reseeding?".
 */

/** The failure controls a scenario exposes. All of them describe the
 * simulated daemon — the browser source has no failure path worth faking. */
export interface DevFaultControls {
  /** Whether the simulated daemon answers at all. */
  daemonOnline: boolean
  /** Artificial latency added to every simulated daemon operation. */
  daemonLatencyMs: number
  /** Whether Connect's permission step is refused. */
  permissionDenied: boolean
  /** Whether discovery (and the discovery step of Connect) fails. */
  discoveryFailure: boolean
  /** Whether the daemon refuses mutations. */
  mutationFailure: boolean
  /** Whether mutations are rejected with a stale-revision problem. */
  staleResponses: boolean
}

export const DEFAULT_FAULTS: DevFaultControls = {
  daemonOnline: true,
  daemonLatencyMs: 0,
  permissionDenied: false,
  discoveryFailure: false,
  mutationFailure: false,
  staleResponses: false,
}

export const LATENCY_CHOICES = [0, 300, 1200, 3000] as const

/** The persisted runtime: which scenario is active and in what shape. */
export interface DevRuntimeSnapshot {
  scenarioId: string
  faults: DevFaultControls
  /** Bumped by every scenario change and reset; the seed stamp matches it. */
  revision: number
}

const DEV_DB_NAME = "bookmarks-but-better-dev"
const DEV_DB_VERSION = 1
export const STATE_STORE = "state"
export const SOURCES_STORE = "sources"
export const PREFS_STORE = "prefs"
const RUNTIME_KEY = "runtime"

/** The application's preferences DB, where the seed stamp lives. */
const PREFS_DB_NAME = "bookmarks-but-better-prefs"
const PREFS_DB_VERSION = 1
const APP_PREFS_STORE = "preferences"
const APPLIED_STAMP_KEY = "dev.workbench.appliedScenario"

function openDB(
  name: string,
  version: number,
  stores: string[]
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const store of stores) {
        if (!db.objectStoreNames.contains(store)) {
          db.createObjectStore(store)
        }
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function withStore<T>(
  name: string,
  version: number,
  stores: string[],
  store: string,
  mode: IDBTransactionMode,
  run: (objectStore: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB(name, version, stores).then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const request = run(tx.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        tx.oncomplete = () => db.close()
      })
  )
}

export function devGet<T>(store: string, key: string): Promise<T | null> {
  return withStore(
    DEV_DB_NAME,
    DEV_DB_VERSION,
    [STATE_STORE, SOURCES_STORE, PREFS_STORE],
    store,
    "readonly",
    (s) => s.get(key)
  ).then((value) => (value === undefined ? null : (value as T)))
}

export function devPut<T>(store: string, key: string, value: T): Promise<void> {
  return withStore(
    DEV_DB_NAME,
    DEV_DB_VERSION,
    [STATE_STORE, SOURCES_STORE, PREFS_STORE],
    store,
    "readwrite",
    (s) => s.put(value, key)
  ).then(() => undefined)
}

export function devDelete(store: string, key: string): Promise<void> {
  return withStore(
    DEV_DB_NAME,
    DEV_DB_VERSION,
    [STATE_STORE, SOURCES_STORE, PREFS_STORE],
    store,
    "readwrite",
    (s) => s.delete(key)
  ).then(() => undefined)
}

/**
 * Clears every persisted source tree and per-source preference: both stores
 * the simulated world owns, in one transaction, so a reset restores the
 * scenario's seed exactly.
 */
export function clearSourceData(): Promise<void> {
  return openDB(DEV_DB_NAME, DEV_DB_VERSION, [
    STATE_STORE,
    SOURCES_STORE,
    PREFS_STORE,
  ]).then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction([SOURCES_STORE, PREFS_STORE], "readwrite")
        tx.objectStore(SOURCES_STORE).clear()
        tx.objectStore(PREFS_STORE).clear()
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
  )
}

/**
 * Scenario-reset sealing for simulated source data.
 *
 * `clearSourceData` wipes the sources and prefs stores, but a write still in
 * flight for the old world (a latency-delayed mutation — or preference save —
 * still awaiting its persist) could otherwise land after the wipe and
 * resurrect pre-reset state — while the fresh (scenario, revision) stamp
 * suppresses the reseed that should have caught it. A reseeding reset
 * therefore seals the epoch first; engine and storage writes capture the
 * epoch when their engine or adapter is created and are dropped once it has
 * moved on.
 *
 * Transaction ordering makes the split safe: an IndexedDB write whose
 * transaction was created before the wipe's commits before it (and is
 * wiped), while one created after it is exactly the resurrecting write the
 * seal drops. The check below runs in the same synchronous step that
 * creates the transaction, so no seal can slip between the two.
 */
let sourceEpoch = 0

/** The epoch engines capture when they are created. */
export function currentSourceEpoch(): number {
  return sourceEpoch
}

/** Seals every source-data write begun under the current epoch. */
export function sealSourceEpoch(): void {
  sourceEpoch += 1
}

/**
 * A dev-store put dropped when the epoch it was begun under was sealed —
 * for the simulated sources' tree and preference persistence. Unlike
 * `devPut`, the seal is re-checked after the database is open, immediately
 * before the write's transaction is created.
 */
export function devPutUnlessSealed<T>(
  store: string,
  key: string,
  value: T,
  epoch: number
): Promise<void> {
  return openDB(DEV_DB_NAME, DEV_DB_VERSION, [
    STATE_STORE,
    SOURCES_STORE,
    PREFS_STORE,
  ]).then((db) => {
    if (epoch !== sourceEpoch) {
      db.close()
      return
    }
    return new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite")
      const request = tx.objectStore(store).put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
      tx.oncomplete = () => db.close()
    })
  })
}

export function readRuntime(): Promise<DevRuntimeSnapshot | null> {
  return devGet<DevRuntimeSnapshot>(STATE_STORE, RUNTIME_KEY)
}

export function writeRuntime(state: DevRuntimeSnapshot): Promise<void> {
  return devPut(STATE_STORE, RUNTIME_KEY, state)
}

export interface AppliedScenarioStamp {
  scenarioId: string
  revision: number
  /** Invalidates persisted dev trees when the checked-in seed changes. */
  seedVersion: number
}

export function readAppliedStamp(): Promise<AppliedScenarioStamp | null> {
  return withStore(
    PREFS_DB_NAME,
    PREFS_DB_VERSION,
    [APP_PREFS_STORE],
    APP_PREFS_STORE,
    "readonly",
    (s) => s.get(APPLIED_STAMP_KEY)
  ).then((value) =>
    value && typeof value === "object" ? (value as AppliedScenarioStamp) : null
  )
}

export function writeAppliedStamp(stamp: AppliedScenarioStamp): Promise<void> {
  return withStore(
    PREFS_DB_NAME,
    PREFS_DB_VERSION,
    [APP_PREFS_STORE],
    APP_PREFS_STORE,
    "readwrite",
    (s) => s.put(stamp, APPLIED_STAMP_KEY)
  ).then(() => undefined)
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
