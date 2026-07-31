// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest"
import { installFakeIndexedDB } from "../../__tests__/fake-indexeddb"
import { DaemonStorageAdapter } from "../storage"
import { StandaloneStorageAdapter } from "../../standalone/storage"
import {
  setAdapterModePreference,
  getAdapterModePreference,
} from "../../adapter-preference"

installFakeIndexedDB()

afterEach(() => {
  installFakeIndexedDB()
})

describe("DaemonStorageAdapter", () => {
  it("round-trips a value", async () => {
    const storage = new DaemonStorageAdapter()
    await storage.set("rootFolderId", "abc123")
    expect(await storage.get("rootFolderId")).toBe("abc123")
  })

  it("returns null for a key that was never set", async () => {
    const storage = new DaemonStorageAdapter()
    expect(await storage.get("rootFolderId")).toBeNull()
  })

  it("removes a key", async () => {
    const storage = new DaemonStorageAdapter()
    await storage.set("nestedFolders", true)
    await storage.remove("nestedFolders")
    expect(await storage.get("nestedFolders")).toBeNull()
  })

  it("does not see a Standalone preference of the same name, and vice versa", async () => {
    const daemon = new DaemonStorageAdapter()
    const standalone = new StandaloneStorageAdapter()

    await standalone.set("rootFolderId", "standalone-root")
    await daemon.set("rootFolderId", "daemon-root")

    expect(await standalone.get("rootFolderId")).toBe("standalone-root")
    expect(await daemon.get("rootFolderId")).toBe("daemon-root")
  })

  it("does not disturb the adapter-mode preference it shares the object store with", async () => {
    await setAdapterModePreference("daemon")
    const daemon = new DaemonStorageAdapter()
    await daemon.set(
      "adapterMode",
      "this is a UI preference, not the routing key"
    )

    // adapter-preference.ts reads its own namespaced key, unaffected by
    // anything written through the daemon storage adapter's `adapterMode`.
    expect(await getAdapterModePreference()).toBe("daemon")
  })

  describe("legacy-key migration", () => {
    it("copies a pre-existing unprefixed preference into the daemon namespace", async () => {
      // Simulates a profile that used daemon mode before namespacing existed:
      // `rootFolderId` was written straight into the shared store.
      const standalone = new StandaloneStorageAdapter()
      await standalone.set("rootFolderId", "legacy-daemon-root")
      await standalone.set("colorTheme", "cyberpunk")

      const daemon = new DaemonStorageAdapter()
      expect(await daemon.get("rootFolderId")).toBe("legacy-daemon-root")
      expect(await daemon.get("colorTheme")).toBe("cyberpunk")
    })

    it("never deletes the original unprefixed key, so Standalone keeps reading it", async () => {
      const standalone = new StandaloneStorageAdapter()
      await standalone.set("cardLayouts", { root: "grid" })

      const daemon = new DaemonStorageAdapter()
      await daemon.get("cardLayouts")

      expect(await standalone.get("cardLayouts")).toEqual({ root: "grid" })
    })

    it("does not migrate the adapter-mode routing key into the UI namespace", async () => {
      await setAdapterModePreference("standalone")

      const daemon = new DaemonStorageAdapter()
      // If migration had copied it, this key would come back non-null.
      expect(await daemon.get("adapterMode")).toBeNull()
    })

    it("only copies forward once: a later Standalone write is not retroactively migrated", async () => {
      const daemonFirst = new DaemonStorageAdapter()
      await daemonFirst.get("rootFolderId") // triggers the one-time migration

      const standalone = new StandaloneStorageAdapter()
      await standalone.set("rootFolderId", "written after migration ran")

      const daemonSecond = new DaemonStorageAdapter()
      expect(await daemonSecond.get("rootFolderId")).toBeNull()
    })

    it("lets a value set through the daemon adapter win over a stale legacy copy on the next read", async () => {
      const standalone = new StandaloneStorageAdapter()
      await standalone.set("maxColumns", 3)

      const daemon = new DaemonStorageAdapter()
      expect(await daemon.get("maxColumns")).toBe(3)

      await daemon.set("maxColumns", 5)
      expect(await daemon.get("maxColumns")).toBe(5)
      // Standalone's own value is untouched by the daemon adapter's write.
      expect(await standalone.get("maxColumns")).toBe(3)
    })
  })
})
