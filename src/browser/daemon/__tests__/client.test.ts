import { afterEach, describe, expect, it, vi } from "vitest"
import { DaemonApiError, fetchHealth, fetchTree, createNode } from "../client"

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  const status = init.status ?? 200
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
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

    await expect(fetchHealth()).resolves.toEqual({ status: "ok" })
  })

  it("requests the fixed /api/v1 base path", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ root: {} }))
    vi.stubGlobal("fetch", fetchMock)

    await fetchTree()

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/tree")
  })

  it("routes bookmark creation to /bookmarks with a JSON body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse({ id: "b1", title: "Example", url: "https://example.com" })
      )
    vi.stubGlobal("fetch", fetchMock)

    await createNode("bookmark", {
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

    await expect(fetchHealth()).rejects.toMatchObject({
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

    await expect(fetchHealth()).rejects.toMatchObject({
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

    const pending = fetchHealth()
    const assertion = expect(pending).rejects.toMatchObject({
      name: "DaemonApiError",
      isTimeout: true,
    })

    await vi.runAllTimersAsync()
    await assertion
  })
})

describe("DaemonApiError", () => {
  it("is a real Error subclass", () => {
    const error = new DaemonApiError("boom", { status: 404 })
    expect(error).toBeInstanceOf(Error)
    expect(error.status).toBe(404)
  })
})
