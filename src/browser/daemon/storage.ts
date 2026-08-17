/**
 * UI preferences for daemon sources (served or extension), namespaced per
 * Vault.
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
 * Two Vaults hosted by one daemon are in exactly that situation relative to
 * each other — and so are two daemons that happen to use the same vault id —
 * so every key here lives under
 * `bookmarks-but-better.daemon.ui.<origin-slug>.<vaultId>.` once a vault is
 * named. With no vault named (the single-Vault served app), the original
 * `bookmarks-but-better.daemon.ui.` namespace is kept, so those profiles
 * keep the preferences they already wrote.
 */

import type { StorageAdapter } from "../types"
import { ADAPTER_PREF_KEY } from "../adapter-preference"

const DB_NAME = "bookmarks-but-better-prefs"
const DB_VERSION = 1
const STORE_NAME = "preferences"

const LEGACY_NAMESPACE = "bookmarks-but-better.daemon.ui."
const LEGACY_MIGRATION_FLAG = `${LEGACY_NAMESPACE}migratedLegacyKeys`
/** Nothing under this prefix is a legacy UI preference — it is this module's
 * own namespace, or `adapter-preference.ts`'s. */
const OWNED_PREFIX = "bookmarks-but-better.daemon."

/** `http://127.0.0.1:52222` → `127.0.0.1-52222`; same-origin → `served`. */
export function originSlug(origin: string): string {
  const slug = origin
    .replace(/^https?:\/\//, "")
    .replaceAll(":", "-")
    .replaceAll("/", "")
    .replaceAll(".", "-")
    .replaceAll("#", "")
  return slug || "served"
}

/** The namespace one vault's preferences live under. */
export function daemonVaultNamespace(
  origin: string | undefined,
  vaultId: string | null | undefined
): string {
  if (!vaultId) {
    return LEGACY_NAMESPACE
  }
  return `bookmarks-but-better.daemon.ui.${originSlug(origin ?? "")}.${vaultId}.`
}

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
          store.put(value, `${LEGACY_NAMESPACE}${key}`)
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

export interface DaemonStorageOptions {
  /** The connection's canonical origin; `undefined` for the served app. */
  origin?: string
  /** The vault whose preferences this adapter namespaces; `null` keeps the
   * legacy single-vault namespace. */
  vaultId?: string | null
}

export class DaemonStorageAdapter implements StorageAdapter {
  private db: IDBDatabase | null = null
  private migrated: Promise<void> | null = null
  private readonly namespace: string

  constructor(options: DaemonStorageOptions = {}) {
    this.namespace = daemonVaultNamespace(options.origin, options.vaultId)
  }

  private async ready(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDB()
    }
    // Persisted behind `LEGACY_MIGRATION_FLAG`, so every instance after the
    // very first one this profile ever creates resolves this immediately.
    // Only the legacy namespace needs it: the per-vault namespaces start
    // empty by construction.
    if (this.namespace === LEGACY_NAMESPACE) {
      this.migrated ??= migrateLegacyKeysOnce(this.db)
      await this.migrated
    }
    return this.db
  }

  private key(id: string): string {
    return `${this.namespace}${id}`
  }

  async get<T>(key: string): Promise<T | null> {
    const db = await this.ready()
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
    const db = await this.ready()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx.objectStore(STORE_NAME).put(value, this.key(key))
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }

  async remove(key: string): Promise<void> {
    const db = await this.ready()
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const request = tx.objectStore(STORE_NAME).delete(this.key(key))
      request.onsuccess = () => resolve()
      request.onerror = () => reject(request.error)
    })
  }
}
