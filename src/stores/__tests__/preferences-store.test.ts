// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { getAdapterModePreference } from "@/browser/adapter-preference"
import { usePreferencesStore } from "../preferences-store"
import type { BrowserAdapter } from "@/browser"

installFakeIndexedDB()

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

/**
 * A stand-in for the Chrome adapter: its storage backend is chrome.storage,
 * completely separate from the pre-adapter IndexedDB preference store.
 */
function createChromeLikeAdapter(): BrowserAdapter {
  const backing = new Map<string, unknown>()
  return {
    bookmarks: {
      getTree: vi.fn().mockResolvedValue([]),
      getSubTree: vi.fn().mockResolvedValue([]),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      removeTree: vi.fn(),
      move: vi.fn(),
      onChanged: vi.fn(() => () => {}),
      onCreated: vi.fn(() => () => {}),
      onRemoved: vi.fn(() => () => {}),
      onMoved: vi.fn(() => () => {}),
      openInManager: vi.fn(),
    },
    storage: {
      get: vi.fn(async (key: string) =>
        backing.has(key) ? backing.get(key) : null
      ),
      set: vi.fn(async (key: string, value: unknown) => {
        backing.set(key, value)
      }),
      remove: vi.fn(async (key: string) => {
        backing.delete(key)
      }),
    },
    favicon: { getUrl: vi.fn(), isAvailable: vi.fn().mockReturnValue(true) },
    capabilities: { openInManager: true },
  }
}

describe("usePreferencesStore adapter mode", () => {
  it("persists the adapter mode switch to the shared pre-adapter store, not the active adapter's storage", async () => {
    const chromeLikeAdapter = createChromeLikeAdapter()
    usePreferencesStore.setState({ adapter: chromeLikeAdapter })

    usePreferencesStore.getState().setAdapterMode("standalone")

    expect(usePreferencesStore.getState().adapterMode).toBe("standalone")

    // This is what detectAdapter() reads on the next launch — it must see
    // "standalone" regardless of which adapter was active when the user
    // switched, or switching from browser to standalone would never persist.
    expect(await getAdapterModePreference()).toBe("standalone")

    // The active (chrome-like) adapter's own storage should not have been
    // used as the persistence path for this preference.
    expect(chromeLikeAdapter.storage.set).not.toHaveBeenCalledWith(
      "adapterMode",
      "standalone"
    )
  })
})
