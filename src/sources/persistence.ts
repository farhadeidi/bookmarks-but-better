/**
 * Persistence for the Source Configuration: one IndexedDB key in the fixed
 * preferences database that exists independently of any adapter, exactly like
 * the adapter-mode preference it replaces. The source layer must be able to
 * read this before it can construct any adapter, so it cannot live behind a
 * `StorageAdapter` — whichever source happened to be active would write it
 * somewhere different, and the next launch would read from the wrong place.
 */

import {
  getAdapterModePreference,
  getDaemonConnectionConfig,
} from "@/browser/adapter-preference"
import type { PlatformCapabilities } from "./platform"
import {
  migrateFromAdapterMode,
  normalizeSourceConfig,
  type SourceConfig,
} from "./config"

const DB_NAME = "bookmarks-but-better-prefs"
const DB_VERSION = 1
const STORE_NAME = "preferences"
const SOURCE_CONFIG_KEY = "sourceConfig"

function isSourceConfig(value: unknown): value is SourceConfig {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.version === 2 &&
    typeof record.sources === "object" &&
    record.sources !== null &&
    typeof record.connections === "object" &&
    record.connections !== null
  )
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

async function readRaw(): Promise<unknown> {
  try {
    const db = await openPreferenceDB()
    return await new Promise<unknown>((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly")
      const request = tx.objectStore(STORE_NAME).get(SOURCE_CONFIG_KEY)
      request.onsuccess = () => resolve(request.result ?? null)
      request.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

/** Writes the config. Best-effort: an unavailable IndexedDB means the config
 * does not persist across launches, never a thrown error. */
export async function saveSourceConfig(config: SourceConfig): Promise<void> {
  try {
    const db = await openPreferenceDB()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx.objectStore(STORE_NAME).put(config, SOURCE_CONFIG_KEY)
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  } catch {
    // As above.
  }
}

/**
 * Reads the profile's Source Configuration, migrating it once from the
 * version-1 adapter-mode preference when no v2 document exists yet.
 *
 * The returned config always has its invariants repaired for this platform,
 * so a config written by a Chrome profile and somehow read by a Safari one
 * cannot enable a Browser Source Safari does not have.
 */
export async function loadSourceConfig(
  caps: PlatformCapabilities
): Promise<SourceConfig> {
  const stored = await readRaw()
  if (isSourceConfig(stored)) {
    return normalizeSourceConfig(stored, caps)
  }

  // Version 1: the scalar mode plus the one connection it could store.
  const [adapterMode, daemonConnection] = await Promise.all([
    getAdapterModePreference(),
    getDaemonConnectionConfig(),
  ])

  const migrated = migrateFromAdapterMode(
    { adapterMode, daemonConnection },
    caps
  )
  await saveSourceConfig(migrated)
  return migrated
}
