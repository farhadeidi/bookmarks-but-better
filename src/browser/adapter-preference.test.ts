// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "./__tests__/fake-indexeddb"
import {
  clearDaemonConnectionConfig,
  getAdapterModePreference,
  getDaemonConnectionConfig,
  setAdapterModePreference,
  setDaemonConnectionConfig,
} from "./adapter-preference"
import { StandaloneStorageAdapter } from "./standalone/storage"
import { DaemonEndpointError } from "./daemon/endpoint"

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

  it("round-trips the new daemon mode without disturbing the two that existed", async () => {
    await setAdapterModePreference("daemon")
    expect(await getAdapterModePreference()).toBe("daemon")

    await setAdapterModePreference("browser")
    expect(await getAdapterModePreference()).toBe("browser")
  })

  it("reads an unrecognised stored mode as absent rather than trusting it", async () => {
    // What a downgrade, or a hand-edited store, can leave behind.
    await new StandaloneStorageAdapter().set("adapterMode", "telepathy")
    expect(await getAdapterModePreference()).toBeNull()
  })
})

describe("daemon connection config", () => {
  it("returns null when nothing has been stored yet", async () => {
    expect(await getDaemonConnectionConfig()).toBeNull()
  })

  it("canonicalizes the origin on the way in, so storage only ever holds one spelling", async () => {
    await setDaemonConnectionConfig({ origin: "LOCALHOST" })
    expect(await getDaemonConnectionConfig()).toEqual({
      origin: "http://localhost:52222",
    })
  })

  it("round-trips an explicit custom port, which is what an existing 47321 install needs", async () => {
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:47321" })
    expect(await getDaemonConnectionConfig()).toEqual({
      origin: "http://127.0.0.1:47321",
    })
  })

  it("round-trips an optional bearer token", async () => {
    await setDaemonConnectionConfig({
      origin: "http://127.0.0.1:52222",
      bearerToken: "token-abc",
    })
    expect(await getDaemonConnectionConfig()).toEqual({
      origin: "http://127.0.0.1:52222",
      bearerToken: "token-abc",
    })
  })

  it("omits the token key entirely rather than storing an empty string", async () => {
    await setDaemonConnectionConfig({
      origin: "http://127.0.0.1:52222",
      bearerToken: "",
    })
    expect(await getDaemonConnectionConfig()).toEqual({
      origin: "http://127.0.0.1:52222",
    })
  })

  it("refuses to store a non-loopback endpoint at all", async () => {
    await expect(
      setDaemonConnectionConfig({ origin: "http://192.168.1.10:52222" })
    ).rejects.toBeInstanceOf(DaemonEndpointError)

    expect(await getDaemonConnectionConfig()).toBeNull()
  })

  it("treats a stored non-loopback origin as absent, since storage is not a trust boundary", async () => {
    // Devtools, a profile sync, or a downgrade could put this here; it must
    // never become a request.
    await new StandaloneStorageAdapter().set("bbb.daemon.connection", {
      origin: "http://evil.example:52222",
    })
    expect(await getDaemonConnectionConfig()).toBeNull()
  })

  it("treats a malformed stored record as absent", async () => {
    const storage = new StandaloneStorageAdapter()
    for (const value of [42, "http://127.0.0.1:52222", {}, { origin: 7 }]) {
      await storage.set("bbb.daemon.connection", value)
      expect(await getDaemonConnectionConfig()).toBeNull()
    }
  })

  it("clears the stored endpoint, leaving no tombstone that could hold a token", async () => {
    await setDaemonConnectionConfig({
      origin: "http://127.0.0.1:52222",
      bearerToken: "token-abc",
    })
    await clearDaemonConnectionConfig()

    expect(await getDaemonConnectionConfig()).toBeNull()
    expect(
      await new StandaloneStorageAdapter().get("bbb.daemon.connection")
    ).toBeNull()
  })

  it("is namespaced away from the UI preferences sharing the same object store", async () => {
    const storage = new StandaloneStorageAdapter()
    await storage.set("connection", "a standalone preference")
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:52222" })

    // Neither key sees the other.
    expect(await storage.get("connection")).toBe("a standalone preference")
    expect(await getDaemonConnectionConfig()).toEqual({
      origin: "http://127.0.0.1:52222",
    })
    expect(await getAdapterModePreference()).toBeNull()
  })
})
