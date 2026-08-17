/**
 * What remains of adapter detection once sources own the choice: the
 * one-time preferences migration off `chrome.storage.sync`, and the runtime
 * probe for "is this a browser extension context". Which concrete adapter to
 * build is decided per source in `src/sources/adapters.ts`.
 */

const SYNC_MIGRATION_FLAG = "__syncToLocalMigrated"

export function isBrowserExtension(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      typeof chrome.bookmarks !== "undefined" &&
      typeof chrome.storage !== "undefined"
    )
  } catch {
    return false
  }
}

/**
 * One-time migration of preferences from chrome.storage.sync to
 * chrome.storage.local. Preferences used to sync across devices, but the
 * stored `rootFolderId` is a browser-assigned bookmark node id that is local
 * to each profile/OS, so syncing it broke the root folder on other machines.
 *
 * Copies all existing sync keys (including rootFolderId) into local once, then
 * sets a flag so it never runs again. Sync storage is intentionally left
 * untouched so devices that haven't updated yet keep reading their settings.
 */
export async function migrateSyncToLocal(): Promise<void> {
  try {
    const flag = await chrome.storage.local.get(SYNC_MIGRATION_FLAG)
    if (flag[SYNC_MIGRATION_FLAG]) return

    const synced = await chrome.storage.sync.get(null)
    if (Object.keys(synced).length > 0) {
      await chrome.storage.local.set(synced)
    }
    await chrome.storage.local.set({ [SYNC_MIGRATION_FLAG]: true })
  } catch {
    // Best-effort: if sync storage is unavailable there is nothing to migrate.
  }
}
