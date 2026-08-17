// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "@/browser/__tests__/fake-indexeddb"
import { usePreferencesStore } from "../preferences-store"
import { ProfileStorageAdapter } from "../profile-storage"
import type { BrowserAdapter, StorageAdapter } from "@/browser"

installFakeIndexedDB()

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

/**
 * A source-scoped stand-in: an in-memory map, like Standalone's IndexedDB in
 * miniature, so each test controls exactly what the "active source" holds.
 */
function memoryStorage(backing = new Map<string, unknown>()): StorageAdapter {
  return {
    get: async <T>(key: string): Promise<T | null> =>
      backing.has(key) ? (backing.get(key) as T) : null,
    set: async (key: string, value: unknown) => {
      backing.set(key, value)
    },
    remove: async (key: string) => {
      backing.delete(key)
    },
  }
}

function adapterWith(storage: StorageAdapter): BrowserAdapter {
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
    storage,
    favicon: { getUrl: vi.fn(), isAvailable: vi.fn().mockReturnValue(true) },
    capabilities: {
      openInManager: true,
      move: true,
      reorder: true,
      setChildOrder: false,
    },
  }
}

describe("usePreferencesStore lifetimes", () => {
  it("reads profile-wide keys from the source's storage once, then only from the profile namespace", async () => {
    // What an upgrading profile has: a colorTheme written wherever the old
    // active source's adapter put it. (`folderOrder` is present so the
    // dev-seed path — which fills a wholly fresh profile — stays out.)
    const sourceBacking = new Map<string, unknown>([
      ["colorTheme", "caffeine"],
      ["folderOrder", []],
    ])
    const source = memoryStorage(sourceBacking)
    await usePreferencesStore.getState().init(adapterWith(source))

    expect(usePreferencesStore.getState().colorTheme).toBe("caffeine")

    // The read was migrated into the profile namespace…
    const profile = new ProfileStorageAdapter()
    expect(await profile.get("colorTheme")).toBe("caffeine")

    // …and a source that never had the value sees the profile's.
    const fresh = memoryStorage()
    await usePreferencesStore.getState().init(adapterWith(fresh))
    expect(usePreferencesStore.getState().colorTheme).toBe("caffeine")
  })

  it("profile-wide writes land in the profile namespace, not the source's", async () => {
    const sourceBacking = new Map<string, unknown>([["folderOrder", []]])
    const source = memoryStorage(sourceBacking)
    await usePreferencesStore.getState().init(adapterWith(source))

    usePreferencesStore.getState().setMaxColumns(5)
    usePreferencesStore.getState().setNestedFolders(true)

    const profile = new ProfileStorageAdapter()
    expect(await profile.get("maxColumns")).toBe(5)
    expect(await profile.get("nestedFolders")).toBe(true)
    expect(sourceBacking.has("maxColumns")).toBe(false)
    expect(sourceBacking.has("nestedFolders")).toBe(false)
  })

  it("source-scoped keys stay with the source they were read from", async () => {
    const firstBacking = new Map<string, unknown>([
      ["rootFolderLike", "ignored"],
      ["cardLayouts", { folderA: "grid" }],
      ["folderOrder", ["x", "y"]],
    ])
    await usePreferencesStore
      .getState()
      .init(adapterWith(memoryStorage(firstBacking)))

    expect(usePreferencesStore.getState().cardLayouts).toEqual({
      folderA: "grid",
    })
    expect(usePreferencesStore.getState().folderOrder).toEqual(["x", "y"])

    // Switching sources re-reads those keys from the new source's storage.
    await usePreferencesStore
      .getState()
      .init(adapterWith(memoryStorage(new Map([["folderOrder", []]]))))

    expect(usePreferencesStore.getState().cardLayouts).toEqual({})
    expect(usePreferencesStore.getState().folderOrder).toEqual([])

    // While profile-wide state survives the switch untouched.
    const profile = new ProfileStorageAdapter()
    expect(await profile.get("cardLayouts")).toBeNull()
  })

  it("a source-scoped write goes through the active adapter's storage", async () => {
    const backing = new Map<string, unknown>([["folderOrder", []]])
    await usePreferencesStore
      .getState()
      .init(adapterWith(memoryStorage(backing)))

    usePreferencesStore.getState().setCardLayout("folderA", "list")

    expect(backing.get("cardLayouts")).toEqual({ folderA: "list" })
  })

  it("a superseded session's reads do not overwrite the newer session's values", async () => {
    // Session A starts reading, then a second transition supersedes it and
    // finishes its own init first; A's reads resolve only afterwards.
    let releaseReads: () => void = () => {}
    const readsGate = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    const staleBacking = new Map<string, unknown>([
      ["cardLayouts", { staleFolder: "grid" }],
      ["folderOrder", ["stale"]],
    ])
    const gatedStorage: ReturnType<typeof memoryStorage> = {
      ...memoryStorage(staleBacking),
      get: async <T>(key: string): Promise<T | null> => {
        await readsGate
        return staleBacking.has(key) ? (staleBacking.get(key) as T) : null
      },
    }
    const staleAdapter = adapterWith(gatedStorage)
    const freshAdapter = adapterWith(
      memoryStorage(new Map<string, unknown>([["folderOrder", []]]))
    )

    let token = 1
    const stale = usePreferencesStore
      .getState()
      .init(staleAdapter, { isCurrent: () => token === 1 })
    token = 2
    await usePreferencesStore
      .getState()
      .init(freshAdapter, { isCurrent: () => token === 2 })

    expect(usePreferencesStore.getState().adapter).toBe(freshAdapter)
    expect(usePreferencesStore.getState().cardLayouts).toEqual({})
    expect(usePreferencesStore.getState().folderOrder).toEqual([])

    releaseReads()
    await stale

    // The stale session's source-scoped values must not land over the
    // newer session's.
    expect(usePreferencesStore.getState().adapter).toBe(freshAdapter)
    expect(usePreferencesStore.getState().cardLayouts).toEqual({})
    expect(usePreferencesStore.getState().folderOrder).toEqual([])
  })
})
