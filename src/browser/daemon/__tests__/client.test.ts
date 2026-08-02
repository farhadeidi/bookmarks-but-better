import { afterEach, describe, expect, it, vi } from "vitest"
import {
  DaemonApiError,
  DaemonClient,
  createSameOriginDaemonClient,
} from "../client"

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

/** The served-UI configuration: relative URLs, no credentials. */
function served() {
  return createSameOriginDaemonClient()
}

describe("daemon client", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("parses a successful JSON response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }))
    )

    await expect(served().fetchHealth()).resolves.toEqual({ status: "ok" })
  })

  it("requests the fixed /api/v1 base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ root: {} }))
    vi.stubGlobal("fetch", fetchMock)

    await served().fetchTree()

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/tree")
  })

  it("encodes daemon search query and bounded result count", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ results: [] }))
    vi.stubGlobal("fetch", fetchMock)

    await served().search("rust & web", 8)

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/search?q=rust+%26+web&limit=8"
    )
  })

  it("routes bookmark creation to /bookmarks with a JSON body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ id: "b1", title: "Example", url: "https://example.com" })
      )
    vi.stubGlobal("fetch", fetchMock)

    await served().createNode("bookmark", {
      parentId: "root",
      title: "Example",
      url: "https://example.com",
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/v1/bookmarks")
    expect(init.method).toBe("POST")
    expect(JSON.parse(init.body)).toEqual({
      parentId: "root",
      title: "Example",
      url: "https://example.com",
    })
  })

  it("throws a DaemonApiError with the problem+json detail on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            title: "Conflict",
            detail: "Revision mismatch: the file changed on disk.",
            status: 409,
          },
          { status: 409 }
        )
      )
    )

    await expect(served().fetchHealth()).rejects.toMatchObject({
      name: "DaemonApiError",
      status: 409,
      message: "Revision mismatch: the file changed on disk.",
    })
  })

  it("falls back to the status text when the error body isn't JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("not json", { status: 500, statusText: "Server Error" })
        )
    )

    await expect(served().fetchHealth()).rejects.toMatchObject({
      status: 500,
      message: "500 Server Error",
    })
  })

  it("aborts and throws a timeout DaemonApiError when the request takes too long", async () => {
    vi.useFakeTimers()

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const error = new Error("Aborted")
            error.name = "AbortError"
            reject(error)
          })
        })
      })
    )

    const pending = served().fetchHealth()
    const assertion = expect(pending).rejects.toMatchObject({
      name: "DaemonApiError",
      isTimeout: true,
    })

    await vi.runAllTimersAsync()
    await assertion
  })
})

describe("DaemonClient configuration", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it("keeps URLs relative when the origin is empty, so the served UI never provokes CORS", () => {
    const client = served()
    expect(client.origin).toBe("")
    expect(client.url("/tree")).toBe("/api/v1/tree")
    expect(client.eventsUrl).toBe("/api/v1/events")
  })

  it("prefixes an absolute loopback origin, which is what an extension needs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ tree: [] }))
    vi.stubGlobal("fetch", fetchMock)

    const client = new DaemonClient({ origin: "http://127.0.0.1:52222" })
    await client.fetchTree()

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://127.0.0.1:52222/api/v1/tree"
    )
    expect(client.eventsUrl).toBe("http://127.0.0.1:52222/api/v1/events")
  })

  it("tolerates a trailing slash on the configured origin without doubling it", () => {
    const client = new DaemonClient({ origin: "http://127.0.0.1:52222/" })
    expect(client.url("/tree")).toBe("http://127.0.0.1:52222/api/v1/tree")
  })

  it("sends no Authorization header when no token is configured", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }))
    vi.stubGlobal("fetch", fetchMock)

    const client = new DaemonClient({ origin: "http://127.0.0.1:52222" })
    await client.fetchHealth()

    expect(client.authHeaders()).toEqual({})
    expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty(
      "Authorization"
    )
  })

  it("sends a configured token as a bearer header and never in the URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }))
    vi.stubGlobal("fetch", fetchMock)

    const client = new DaemonClient({
      origin: "http://127.0.0.1:52222",
      bearerToken: "s3cret-token",
    })
    await client.fetchHealth()

    const [url, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe("Bearer s3cret-token")
    // The token must not be reachable from anything that gets logged, put in
    // browser history, or written to the daemon's request log.
    expect(url).not.toContain("s3cret-token")
    expect(client.url("/tree")).not.toContain("s3cret-token")
    expect(client.eventsUrl).not.toContain("s3cret-token")
  })

  it("names only the API path in a timeout message, never the configured origin", async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("Aborted"))
          )
        })
      })
    )

    const client = new DaemonClient({
      origin: "http://127.0.0.1:52222",
      bearerToken: "s3cret-token",
      timeoutMs: 5_000,
    })
    const pending = client.fetchHealth()
    const assertion = expect(pending).rejects.toMatchObject({
      isTimeout: true,
      message: "Request to /health timed out",
    })

    await vi.runAllTimersAsync()
    await assertion
  })

  it("honors a per-client timeout", async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockImplementation((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("Aborted"))
          )
        })
      })
    vi.stubGlobal("fetch", fetchMock)

    const client = new DaemonClient({ timeoutMs: 1_000 })
    const pending = client.fetchHealth()
    const assertion = expect(pending).rejects.toMatchObject({ isTimeout: true })

    await vi.advanceTimersByTimeAsync(1_000)
    await assertion
  })

  it("uses an injected fetch in preference to the global one", async () => {
    const injected = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }))
    const global = vi.fn()
    vi.stubGlobal("fetch", global)

    await new DaemonClient({ fetchImpl: injected }).fetchHealth()

    expect(injected).toHaveBeenCalledTimes(1)
    expect(global).not.toHaveBeenCalled()
  })

  it("keeps two clients independent, so a served UI and an extension can coexist", () => {
    const a = new DaemonClient({ origin: "http://127.0.0.1:52222" })
    const b = new DaemonClient({ origin: "http://localhost:47321" })

    expect(a.url("/tree")).toBe("http://127.0.0.1:52222/api/v1/tree")
    expect(b.url("/tree")).toBe("http://localhost:47321/api/v1/tree")
  })
})

describe("daemon client ordering problem codes", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  /**
   * Status alone can't tell these apart from the codes that already existed —
   * `stale_state_revision` shares 409 with `stale_revision`, and
   * `invalid_order`/`state_read_only` share 422 with `read_only` — so the
   * store switches on `code`, and it has to survive the client.
   */
  const cases = [
    { code: "stale_state_revision", status: 409, detail: "expected abc." },
    { code: "state_read_only", status: 422, detail: "unknown keys present." },
    { code: "invalid_order", status: 422, detail: "`x` is not a child." },
  ] as const

  for (const { code, status, detail } of cases) {
    it(`surfaces ${code} (${status}) as DaemonApiError.code`, async () => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            jsonResponse({ title: "Refused", detail, code, status }, { status })
          )
      )

      await expect(
        served().setOrder("folder-1", {
          children: [{ id: "a", kind: "bookmark" }],
        })
      ).rejects.toMatchObject({
        name: "DaemonApiError",
        code,
        status,
        message: detail,
      })
    })
  }

  it("PUTs the order body verbatim to /api/v1/folders/:id/order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: "f1" }))
    vi.stubGlobal("fetch", fetchMock)

    await served().setOrder("f 1/nested", {
      stateRevision: "state-1",
      children: [
        { id: "a", kind: "bookmark" },
        { id: "b", kind: "folder" },
      ],
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("/api/v1/folders/f%201%2Fnested/order")
    expect(init.method).toBe("PUT")
    expect(JSON.parse(init.body)).toEqual({
      stateRevision: "state-1",
      children: [
        { id: "a", kind: "bookmark" },
        { id: "b", kind: "folder" },
      ],
    })
  })
})

describe("DaemonApiError", () => {
  it("is a real Error subclass", () => {
    const error = new DaemonApiError("boom", { status: 404 })
    expect(error).toBeInstanceOf(Error)
    expect(error.status).toBe(404)
  })
})
