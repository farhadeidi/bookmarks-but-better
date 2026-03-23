import type { StorageAdapter } from "../types"

export class ChromeStorageAdapter implements StorageAdapter {
  async get<T>(key: string): Promise<T | null> {
    const result = await chrome.storage.sync.get(key)
    if (key in result) {
      return result[key] as T
    }
    return null
  }

  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.sync.set({ [key]: value })
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.sync.remove(key)
  }
}
