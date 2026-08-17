// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFakeIndexedDB } from "../../__tests__/fake-indexeddb"
import {
  connectToDaemon,
  discoverDaemonVaults,
  LEGACY_DISCOVERY_VAULT_ID,
} from "../connect"
import { DaemonClient } from "../client"

installFakeIndexedDB()

afterEach(() => {
  vi.unstubAllGlobals()
  installFakeIndexedDB()
})

function fetchSequence(responses: Response[]) {
  const fetchImpl = vi.fn()
  for (const response of responses) {
    fetchImpl.mockImplementationOnce(() => Promise.resolve(response))
  }
  // Anything past the scripted responses fails loudly rather than quietly.
  fetchImpl.mockRejectedValue(new TypeError("unexpected request"))
  return fetchImpl
}

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status })
}

describe("connectToDaemon", () => {
  it("rejects an invalid address at the validate stage without contacting anything", async () => {
    const fetchImpl = fetchSequence([])

    const result = await connectToDaemon("not a loopback address", {
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.stage).toBe("validate")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("rejects a non-loopback host at the validate stage", async () => {
    const fetchImpl = fetchSequence([])
    const result = await connectToDaemon("http://192.168.1.5:52222", {
      fetchImpl,
    })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.stage).toBe("validate")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("stops at the permission stage when the host permission is denied, and never reaches the network", async () => {
    const fetchImpl = fetchSequence([])
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
  it("reaches permissions.request synchronously, before any await resolves", async () => {
    const request = vi.fn((_q: unknown, cb: (granted: boolean) => void) =>
      cb(true)
    )
    vi.stubGlobal("chrome", {
      permissions: {
        contains: (_q: unknown, cb: (granted: boolean) => void) => cb(false),
        request,
      },
    })
    const attempt = connectToDaemon("127.0.0.1:52222", {
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("down")),
    })

    expect(request).toHaveBeenCalledOnce()

    expect(await attempt).toMatchObject({ ok: false, stage: "health" })
  })

  it("reports a health-stage failure when the daemon cannot be reached", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"))

    const result = await connectToDaemon("127.0.0.1:52222", { fetchImpl })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.stage).toBe("health")
  })

  it("reports a health-stage failure when the daemon reports an unhealthy status", async () => {
    const fetchImpl = fetchSequence([jsonResponse({ status: "degraded" })])

    const result = await connectToDaemon("127.0.0.1:52222", { fetchImpl })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.stage).toBe("health")
  })

  it("succeeds with the discovered vaults once health and discovery answer", async () => {
    const fetchImpl = fetchSequence([
      jsonResponse({ status: "ok", version: "4.0.0" }),
      jsonResponse({
        vaults: [
          { id: "reading", name: "Reading" },
          { id: "archive", name: "Archive" },
        ],
      }),
    ])

    const result = await connectToDaemon("127.0.0.1:47321", { fetchImpl })

    expect(result).toMatchObject({
      ok: true,
      origin: "http://127.0.0.1:47321",
      vaults: [
        { id: "reading", name: "Reading" },
        { id: "archive", name: "Archive" },
      ],
      legacyProtocol: false,
    })
    // Health is daemon-level; discovery is daemon-level; neither is scoped.
    expect(fetchImpl.mock.calls[0][0]).toBe(
      "http://127.0.0.1:47321/api/v1/health"
    )
    expect(fetchImpl.mock.calls[1][0]).toBe(
      "http://127.0.0.1:47321/api/v1/vaults"
    )
  })

  it("carries vault warnings through on success without failing the connection", async () => {
    const fetchImpl = fetchSequence([
      jsonResponse({
        status: "ok",
        warnings: [{ code: "w", severity: "warning", detail: "example" }],
      }),
      jsonResponse({ vaults: [{ id: "main" }] }),
    ])

    const result = await connectToDaemon("127.0.0.1:52222", { fetchImpl })

    expect(result.ok).toBe(true)
    expect(result.ok ? result.warnings : undefined).toEqual([
      { code: "w", severity: "warning", detail: "example" },
    ])
  })

  it("a Retry is just the same attempt again, with nothing persisted on failure either way", async () => {
    const first = await connectToDaemon("127.0.0.1:52222", {
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("down")),
    })
    expect(first.ok).toBe(false)

    const second = await connectToDaemon("127.0.0.1:52222", {
      fetchImpl: fetchSequence([
        jsonResponse({ status: "ok" }),
        jsonResponse({ vaults: [{ id: "main" }] }),
      ]),
    })
    expect(second.ok).toBe(true)
  })
})

describe("discoverDaemonVaults", () => {
  it("lists what the daemon reports", async () => {
    const client = new DaemonClient({
      origin: "http://127.0.0.1:52222",
      fetchImpl: fetchSequence([
        jsonResponse({
          vaults: [
            { id: "a", name: "A" },
            { id: "b", name: "B" },
          ],
        }),
      ]),
    })

    expect(await discoverDaemonVaults(client)).toMatchObject({
      vaults: [
        { id: "a", name: "A" },
        { id: "b", name: "B" },
      ],
      legacyProtocol: false,
    })
  })

  it("reports a pre-Vault-id daemon as one legacy vault rather than a failure", async () => {
    const client = new DaemonClient({
      origin: "http://127.0.0.1:52222",
      fetchImpl: fetchSequence([
        jsonResponse(
          {
            type: "about:blank",
            title: "No such route",
            status: 404,
            code: "route_not_found",
            detail: "no such route",
          },
          404
        ),
      ]),
    })

    expect(await discoverDaemonVaults(client)).toMatchObject({
      vaults: [{ id: LEGACY_DISCOVERY_VAULT_ID }],
      legacyProtocol: true,
    })
  })

  it("an empty vault list is read as the legacy single-vault daemon", async () => {
    const client = new DaemonClient({
      origin: "",
      fetchImpl: fetchSequence([jsonResponse({ vaults: [] })]),
    })

    expect(await discoverDaemonVaults(client)).toMatchObject({
      vaults: [{ id: LEGACY_DISCOVERY_VAULT_ID }],
      legacyProtocol: true,
    })
  })

  it("a daemon that cannot be reached surfaces the failure", async () => {
    const client = new DaemonClient({
      origin: "http://127.0.0.1:59999",
      fetchImpl: vi.fn().mockRejectedValue(new TypeError("down")),
    })

    await expect(discoverDaemonVaults(client)).rejects.toThrow()
  })
})
