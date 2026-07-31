/**
 * Persists the user's chosen adapter mode ("browser", "standalone" or
 * "daemon") — and, for daemon mode, where that daemon is — to a fixed
 * IndexedDB location that exists independently of any BrowserAdapter.
 *
 * `detectAdapter` has to read this preference *before* it can construct an
 * adapter, so the preference cannot live behind `StorageAdapter.get/set` —
 * whichever adapter happens to be active would write it somewhere different
 * (chrome.storage.local vs this IndexedDB store), and the next launch would
 * read from the wrong place. This module is the single read/write path so
 * switching between modes persists correctly either way.
 *
 * The object store is shared with `StandaloneStorageAdapter`, which is where
 * ordinary UI preferences (`cardLayouts`, `colorTheme`, …) live and which
 * writes whatever key the UI asks it to. Daemon keys are therefore namespaced
 * under `bbb.daemon.`, a prefix no UI preference or bookmark id uses, so an
 * extension's connection settings cannot be shadowed by — or shadow — a
 * standalone preference that happens to be named similarly.
 */

import type { AdapterMode, DaemonConnectionConfig } from "./types"
import { canonicalizeDaemonOrigin } from "./daemon/endpoint"

const DB_NAME = "bookmarks-but-better-prefs"
const DB_VERSION = 1
const STORE_NAME = "preferences"
/** Exported so `DaemonStorageAdapter`'s legacy-key migration can recognize
 * (and skip) this one — it is mode-routing state, not a UI preference, and
 * must never be copied into the daemon's namespace alongside them. */
export const ADAPTER_PREF_KEY = "adapterMode"

/** Every key this module owns beyond the original `adapterMode` starts here. */
const DAEMON_NAMESPACE = "bbb.daemon."
const DAEMON_CONNECTION_KEY = `${DAEMON_NAMESPACE}connection`

export type { AdapterMode, DaemonConnectionConfig }

const MODES: readonly AdapterMode[] = ["browser", "standalone", "daemon"]

function isAdapterMode(value: unknown): value is AdapterMode {
  return typeof value === "string" && MODES.includes(value as AdapterMode)
}

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

async function read<T>(key: string, parse: (value: unknown) => T | null) {
  try {
    const db = await openPreferenceDB()
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const request = tx.objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve(parse(request.result))
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function write(key: string, value: unknown): Promise<void> {
  try {
    const db = await openPreferenceDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx.objectStore(STORE_NAME).put(value, key)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch {
    // Best-effort: if IndexedDB is unavailable the preference just won't
    // persist across launches.
  }
}

export async function getAdapterModePreference(): Promise<AdapterMode | null> {
  return read(ADAPTER_PREF_KEY, (value) =>
    isAdapterMode(value) ? value : null
  )
}

export async function setAdapterModePreference(
  mode: AdapterMode
): Promise<void> {
  await write(ADAPTER_PREF_KEY, mode)
}

/**
 * The stored daemon endpoint, or `null` when none has been configured.
 *
 * The origin is re-canonicalized on the way out. Storage is not a trust
 * boundary — IndexedDB is editable from devtools and survives downgrades — and
 * a stored value that isn't loopback must not become a request. A value that
 * fails re-validation is treated as absent rather than repaired, so the user
 * is asked again instead of being silently pointed somewhere they didn't
 * choose.
 */
export async function getDaemonConnectionConfig(): Promise<DaemonConnectionConfig | null> {
  return read(DAEMON_CONNECTION_KEY, (value) => {
    if (typeof value !== "object" || value === null) return null
    const record = value as Record<string, unknown>
    if (typeof record.origin !== "string") return null
    let origin: string
    try {
      origin = canonicalizeDaemonOrigin(record.origin)
    } catch {
      return null
    }
    const token = record.bearerToken
    return {
      origin,
      ...(typeof token === "string" && token !== ""
        ? { bearerToken: token }
        : {}),
    }
  })
}

/**
 * Stores the daemon endpoint, canonicalizing it first.
 *
 * @throws {import("./daemon/endpoint").DaemonEndpointError} when the origin is
 * not a usable loopback endpoint. Refusing here rather than storing and
 * failing later is what keeps a rejected address out of persistence entirely.
 */
export async function setDaemonConnectionConfig(
  config: DaemonConnectionConfig
): Promise<void> {
  const origin = canonicalizeDaemonOrigin(config.origin)
  await write(DAEMON_CONNECTION_KEY, {
    origin,
    ...(config.bearerToken ? { bearerToken: config.bearerToken } : {}),
  })
}

/** Forgets the stored endpoint (and any token with it). */
export async function clearDaemonConnectionConfig(): Promise<void> {
  try {
    const db = await openPreferenceDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      // Deleted rather than overwritten with `undefined`: a stored `undefined`
      // is still a record, and a token must not survive as a tombstone.
      const request = tx.objectStore(STORE_NAME).delete(DAEMON_CONNECTION_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => resolve()
    })
  } catch {
    // Best-effort, as above.
  }
}
