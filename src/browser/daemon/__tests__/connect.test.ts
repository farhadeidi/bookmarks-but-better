// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "../../__tests__/fake-indexeddb"
import { connectToDaemon, disconnectDaemon, forgetDaemon } from "../connect"
import {
  getAdapterModePreference,
  getDaemonConnectionConfig,
  setAdapterModePreference,
  setDaemonConnectionConfig,
} from "../../adapter-preference"

installFakeIndexedDB()

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

function okHealthFetch(body: Record<string, unknown> = { status: "ok" }) {
  return vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
}

describe("connectToDaemon", () => {
  it("rejects an invalid address at the validate stage without contacting anything", async () => {
    const fetchImpl = okHealthFetch()

    const result = await connectToDaemon("not a loopback address", {
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.stage).toBe("validate")
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await getAdapterModePreference()).toBeNull()
    expect(await getDaemonConnectionConfig()).toBeNull()
  })

  it("rejects a non-loopback host at the validate stage", async () => {
    const fetchImpl = okHealthFetch()
    const result = await connectToDaemon("http://192.168.1.5:52222", {
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.stage).toBe("validate")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("stops at the permission stage when the host permission is denied, and never reaches the network", async () => {
    const fetchImpl = okHealthFetch()
    vi.stubGlobal("chrome", {
      permissions: {
        contains: (_q: unknown, cb: (granted: boolean) => void) => cb(false),
        request: (_q: unknown, cb: (granted: boolean) => void) => cb(false),
      },
    })

    const result = await connectToDaemon("127.0.0.1:52222", { fetchImpl })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.stage).toBe("permission")
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(await getAdapterModePreference()).toBeNull()
  })

  /**
   * The permission request has to still be inside the Connect button's own
   * click handler when it runs — Firefox reads "is this a user input handler?"
   * off the synchronous call stack — so nothing between the click and
   * `permissions.request` may await. Asserted here rather than only in
   * `permissions.test.ts` because the property belongs to the whole chain: a
   * single `await` added anywhere in `connectToDaemon` above the request would
   * break it just as effectively.
   */
  it("reaches permissions.request synchronously, before any await resolves", () => {
    const request = vi.fn((_q: unknown, cb: (granted: boolean) => void) =>
      cb(true)
    )
    vi.stubGlobal("chrome", {
      permissions: {
        contains: (_q: unknown, cb: (granted: boolean) => void) => cb(false),
        request,
      },
    })

    void connectToDaemon("127.0.0.1:52222", { fetchImpl: okHealthFetch() })

    expect(request).toHaveBeenCalledOnce()
  })

  it("reports a health-stage failure when the daemon cannot be reached", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"))

    const result = await connectToDaemon("127.0.0.1:52222", { fetchImpl })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.stage).toBe("health")
    expect(await getAdapterModePreference()).toBeNull()
    expect(await getDaemonConnectionConfig()).toBeNull()
  })

  it("reports a health-stage failure when the daemon reports an unhealthy status", async () => {
    const fetchImpl = okHealthFetch({ status: "degraded" })

    const result = await connectToDaemon("127.0.0.1:52222", { fetchImpl })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.stage).toBe("health")
    expect(await getAdapterModePreference()).toBeNull()
  })

  it("persists the connection and switches to daemon mode only once every stage succeeds", async () => {
    const fetchImpl = okHealthFetch({ status: "ok", version: "4.0.0" })

    const result = await connectToDaemon("127.0.0.1:47321", { fetchImpl })

    expect(result).toMatchObject({ ok: true, origin: "http://127.0.0.1:47321" })
    expect(await getAdapterModePreference()).toBe("daemon")
    expect(await getDaemonConnectionConfig()).toEqual({
      origin: "http://127.0.0.1:47321",
    })
  })

  it("carries vault warnings through on success without failing the connection", async () => {
    const fetchImpl = okHealthFetch({
      status: "ok",
      warnings: [{ code: "w", severity: "warning", detail: "example" }],
    })

    const result = await connectToDaemon("127.0.0.1:52222", { fetchImpl })

    expect(result.ok).toBe(true)
    expect(result.ok ? result.warnings : undefined).toEqual([
      { code: "w", severity: "warning", detail: "example" },
    ])
  })

  it("preserves whatever source was already configured when a connect attempt fails", async () => {
    await setAdapterModePreference("browser")
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network down"))

    const result = await connectToDaemon("127.0.0.1:52222", { fetchImpl })

    expect(result.ok).toBe(false)
    expect(await getAdapterModePreference()).toBe("browser")
  })

  it("a Retry is just the same attempt again — succeeding after an earlier failure updates the stored mode", async () => {
    await setAdapterModePreference("standalone")
    const failing = vi.fn().mockRejectedValue(new TypeError("down"))
    const first = await connectToDaemon("127.0.0.1:52222", {
      fetchImpl: failing,
    })
    expect(first.ok).toBe(false)
    expect(await getAdapterModePreference()).toBe("standalone")

    const succeeding = okHealthFetch()
    const second = await connectToDaemon("127.0.0.1:52222", {
      fetchImpl: succeeding,
    })
    expect(second.ok).toBe(true)
    expect(await getAdapterModePreference()).toBe("daemon")
  })
})

describe("disconnectDaemon", () => {
  it("switches the mode away from daemon but keeps the stored connection", async () => {
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:47321" })
    await setAdapterModePreference("daemon")

    await disconnectDaemon("browser")

    expect(await getAdapterModePreference()).toBe("browser")
    expect(await getDaemonConnectionConfig()).toEqual({
      origin: "http://127.0.0.1:47321",
    })
  })
})

describe("forgetDaemon", () => {
  it("clears the stored connection, releases the permission, and switches away from daemon mode", async () => {
    const remove = vi.fn((_q: unknown, cb: () => void) => cb())
    vi.stubGlobal("chrome", {
      permissions: {
        contains: (_q: unknown, cb: (granted: boolean) => void) => cb(true),
        remove,
      },
    })
    await setDaemonConnectionConfig({ origin: "http://127.0.0.1:47321" })
    await setAdapterModePreference("daemon")

    await forgetDaemon("standalone")

    expect(await getAdapterModePreference()).toBe("standalone")
    expect(await getDaemonConnectionConfig()).toBeNull()
    expect(remove).toHaveBeenCalledWith(
      { origins: ["http://127.0.0.1/*", "http://localhost/*"] },
      expect.any(Function)
    )
  })
})
