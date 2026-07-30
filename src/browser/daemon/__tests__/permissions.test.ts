import { afterEach, describe, expect, it, vi } from "vitest"
import {
  hasDaemonHostPermission,
  removeDaemonHostPermission,
  requestDaemonHostPermission,
} from "../permissions"

afterEach(() => {
  vi.unstubAllGlobals()
})

interface FakePermissionsApi {
  contains: (query: unknown, callback: (granted: boolean) => void) => void
  request: (query: unknown, callback: (granted: boolean) => void) => void
  remove: (query: unknown, callback: () => void) => void
}

function stubPermissionsApi(overrides: Partial<FakePermissionsApi> = {}) {
  const api: FakePermissionsApi = {
    contains: vi.fn((_query, callback) => callback(false)),
    request: vi.fn((_query, callback) => callback(true)),
    remove: vi.fn((_query, callback) => callback()),
    ...overrides,
  }
  vi.stubGlobal("chrome", { permissions: api })
  return api
}

describe("hasDaemonHostPermission", () => {
  it("returns true when there is no extension permissions API at all", async () => {
    expect(await hasDaemonHostPermission()).toBe(true)
  })

  it("asks chrome.permissions.contains for the loopback host patterns", async () => {
    const api = stubPermissionsApi({
      contains: vi.fn((_query, callback: (granted: boolean) => void) =>
        callback(true)
      ),
    })

    expect(await hasDaemonHostPermission()).toBe(true)
    expect(api.contains).toHaveBeenCalledWith(
      { origins: ["http://127.0.0.1/*", "http://localhost/*"] },
      expect.any(Function)
    )
  })

  it("reflects a denial", async () => {
    stubPermissionsApi({
      contains: vi.fn((_query, callback: (granted: boolean) => void) =>
        callback(false)
      ),
    })
    expect(await hasDaemonHostPermission()).toBe(false)
  })
})

describe("requestDaemonHostPermission", () => {
  it("returns true without prompting when there is no permissions API", async () => {
    expect(await requestDaemonHostPermission()).toBe(true)
  })

  it("skips the prompt entirely when already granted", async () => {
    const request = vi.fn((_query, callback: (granted: boolean) => void) =>
      callback(true)
    )
    stubPermissionsApi({
      contains: vi.fn((_query, callback: (granted: boolean) => void) =>
        callback(true)
      ),
      request,
    })

    expect(await requestDaemonHostPermission()).toBe(true)
    expect(request).not.toHaveBeenCalled()
  })

  it("prompts, and returns what the user decided", async () => {
    const api = stubPermissionsApi({
      request: vi.fn((_query, callback: (granted: boolean) => void) =>
        callback(false)
      ),
    })

    expect(await requestDaemonHostPermission()).toBe(false)
    expect(api.request).toHaveBeenCalledWith(
      { origins: ["http://127.0.0.1/*", "http://localhost/*"] },
      expect.any(Function)
    )
  })
})

describe("removeDaemonHostPermission", () => {
  it("does nothing, without throwing, when there is no permissions API", async () => {
    await expect(removeDaemonHostPermission()).resolves.toBeUndefined()
  })

  it("calls chrome.permissions.remove with the loopback host patterns", async () => {
    const api = stubPermissionsApi()
    await removeDaemonHostPermission()
    expect(api.remove).toHaveBeenCalledWith(
      { origins: ["http://127.0.0.1/*", "http://localhost/*"] },
      expect.any(Function)
    )
  })
})
