// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "./__tests__/fake-indexeddb"
import {
  getAdapterModePreference,
  setAdapterModePreference,
} from "./adapter-preference"

installFakeIndexedDB()

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

describe("adapter mode preference", () => {
  it("returns null when nothing has been stored yet", async () => {
    expect(await getAdapterModePreference()).toBeNull()
  })

  it("round-trips a stored value", async () => {
    await setAdapterModePreference("standalone")
    expect(await getAdapterModePreference()).toBe("standalone")

    await setAdapterModePreference("browser")
    expect(await getAdapterModePreference()).toBe("browser")
  })

  it("persists across separate calls, as detectAdapter and the preferences store each make their own", async () => {
    await setAdapterModePreference("standalone")

    // Simulates two independent readers (e.g. detectAdapter() on next boot,
    // and the preferences store's init()) opening the DB separately.
    expect(await getAdapterModePreference()).toBe("standalone")
    expect(await getAdapterModePreference()).toBe("standalone")
  })
})
