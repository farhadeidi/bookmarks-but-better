import { afterEach, describe, expect, it, vi } from "vitest"
import { connectDaemonEvents, createSseParser, type SseEvent } from "../sse"

/**
 * A stream whose chunks are pushed by the test, so a frame can be split at any
 * byte boundary. `end()` closes it cleanly (which the client treats as a
 * disconnect to recover from); `fail()` rejects the read.
 */
function controllableStream() {
  let controller: ReadableStreamDefaultController<Uint8Array>
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c
    },
  })
  return {
    stream,
    push(text: string) {
      controller.enqueue(encoder.encode(text))
    },
    end() {
      controller.close()
    },
  }
}

function streamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  })
}

/** Lets the microtask queue drain so the reader loop can consume what was pushed. */
async function flush() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("createSseParser", () => {
  function collect() {
    const events: SseEvent[] = []
    return { events, parser: createSseParser((event) => events.push(event)) }
  }

  it("dispatches a complete frame", () => {
    const { events, parser } = collect()
    parser.push("event: changed\ndata: 7\n\n")
    expect(events).toEqual([{ type: "changed", data: "7" }])
  })

  it("reassembles a frame split across arbitrary chunk boundaries", () => {
    const frame = "event: changed\ndata: 7\n\n"
    for (let split = 1; split < frame.length; split += 1) {
      const { events, parser } = collect()
      parser.push(frame.slice(0, split))
      parser.push(frame.slice(split))
      expect(events, `split at ${split}`).toEqual([
        { type: "changed", data: "7" },
      ])
    }
  })

  it("reassembles a frame delivered one character at a time", () => {
    const { events, parser } = collect()
    for (const char of "event: changed\ndata: 7\n\n") parser.push(char)
    expect(events).toEqual([{ type: "changed", data: "7" }])
  })

  it("handles several frames arriving in one chunk", () => {
    const { events, parser } = collect()
    parser.push("event: changed\ndata: 1\n\nevent: changed\ndata: 2\n\n")
    expect(events).toEqual([
      { type: "changed", data: "1" },
      { type: "changed", data: "2" },
    ])
  })

  it("ignores comments and keepalives without dispatching anything", () => {
    const { events, parser } = collect()
    parser.push(": keepalive\n\n")
    parser.push(":\n\n")
    parser.push("\n\n\n")
    expect(events).toEqual([])
  })

  it("keeps a keepalive from splitting a frame that surrounds it", () => {
    const { events, parser } = collect()
    parser.push("event: changed\n")
    parser.push(": keepalive\n")
    parser.push("data: 7\n\n")
    expect(events).toEqual([{ type: "changed", data: "7" }])
  })

  it("accepts CRLF and a lone CR as line terminators", () => {
    const { events, parser } = collect()
    parser.push("event: changed\r\ndata: 1\r\n\r\n")
    // The frame-terminating CR is only resolvable once the byte after it
    // exists, so a following chunk is what releases it — see the test below.
    parser.push("event: changed\rdata: 2\r\r: keepalive\n")
    expect(events).toEqual([
      { type: "changed", data: "1" },
      { type: "changed", data: "2" },
    ])
  })

  it("holds a trailing CR back until the next chunk shows whether an LF follows", () => {
    const { events, parser } = collect()
    parser.push("event: changed\ndata: 7\r")
    expect(events).toEqual([])
    parser.push("\n\n")
    expect(events).toEqual([{ type: "changed", data: "7" }])
  })

  it("joins multiple data lines with a newline, per the grammar", () => {
    const { events, parser } = collect()
    parser.push("event: changed\ndata: a\ndata: b\n\n")
    expect(events).toEqual([{ type: "changed", data: "a\nb" }])
  })

  it("defaults an unnamed event to `message` and tolerates a field with no value", () => {
    const { events, parser } = collect()
    parser.push("data\n\n")
    expect(events).toEqual([{ type: "message", data: "" }])
  })

  it("does not carry an event name into the next frame", () => {
    const { events, parser } = collect()
    parser.push("event: changed\ndata: 1\n\ndata: 2\n\n")
    expect(events).toEqual([
      { type: "changed", data: "1" },
      { type: "message", data: "2" },
    ])
  })
})

describe("connectDaemonEvents", () => {
  it("debounces bursts of `changed` events into a single refresh", async () => {
    const onChanged = vi.fn()
    const source = controllableStream()
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse(source.stream))

    const disconnect = connectDaemonEvents({
      onChanged,
      debounceMs: 250,
      fetchImpl,
      target: null,
      visibility: null,
    })
    await flush()

    vi.useFakeTimers()
    source.push("event: changed\ndata: 1\n\n")
    await flush()
    vi.advanceTimersByTime(100)
    source.push("event: changed\ndata: 2\n\n")
    await flush()
    vi.advanceTimersByTime(100)
    source.push("event: changed\ndata: 3\n\n")
    await flush()

    expect(onChanged).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(onChanged).toHaveBeenCalledTimes(1)

    disconnect()
  })

  it("sends the Accept header and any configured Authorization header, never a token in the URL", async () => {
    const source = controllableStream()
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse(source.stream))

    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      url: "http://127.0.0.1:52222/api/v1/events",
      headers: { Authorization: "Bearer s3cret-token" },
      fetchImpl,
      target: null,
      visibility: null,
    })
    await flush()

    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe("http://127.0.0.1:52222/api/v1/events")
    expect(url).not.toContain("s3cret-token")
    expect(init.headers.Accept).toBe("text/event-stream")
    expect(init.headers.Authorization).toBe("Bearer s3cret-token")

    disconnect()
  })

  it("aborts the in-flight request and stops every timer on cleanup, including a pending debounce", async () => {
    const onChanged = vi.fn()
    const source = controllableStream()
    let signal: AbortSignal | undefined
    const fetchImpl = vi.fn().mockImplementation((_url, init) => {
      signal = init.signal
      return Promise.resolve(streamResponse(source.stream))
    })

    const disconnect = connectDaemonEvents({
      onChanged,
      debounceMs: 250,
      fetchImpl,
      target: null,
      visibility: null,
    })
    await flush()

    vi.useFakeTimers()
    source.push("event: changed\ndata: 1\n\n")
    await flush()

    disconnect()

    expect(signal?.aborted).toBe(true)
    vi.advanceTimersByTime(10_000)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it("reconnects after a failure with a bounded exponential backoff", async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn().mockRejectedValue(new Error("connection refused"))

    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      initialDelayMs: 1_000,
      maxDelayMs: 4_000,
      fetchImpl,
      target: null,
      visibility: null,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(999)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    // Doubles.
    await vi.advanceTimersByTimeAsync(1_999)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    // Capped at maxDelayMs rather than doubling to 8s.
    await vi.advanceTimersByTimeAsync(4_000)
    expect(fetchImpl).toHaveBeenCalledTimes(4)
    await vi.advanceTimersByTimeAsync(4_000)
    expect(fetchImpl).toHaveBeenCalledTimes(5)

    disconnect()
  })

  it("resets the backoff after a connection that actually established", async () => {
    vi.useFakeTimers()
    const first = controllableStream()
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new Error("refused"))
      .mockRejectedValueOnce(new Error("refused"))
      .mockResolvedValueOnce(streamResponse(first.stream))
      .mockRejectedValue(new Error("refused"))

    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      fetchImpl,
      target: null,
      visibility: null,
    })

    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1_000) // 2nd attempt
    await vi.advanceTimersByTimeAsync(2_000) // 3rd attempt: connects
    expect(fetchImpl).toHaveBeenCalledTimes(3)

    // The established stream ends; the next attempt must be one initial delay
    // away, not the four seconds the ladder had climbed to.
    first.end()
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchImpl).toHaveBeenCalledTimes(4)

    disconnect()
  })

  it("treats a non-2xx response as a failure to retry, not as a stream", async () => {
    vi.useFakeTimers()
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 503 }))

    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      initialDelayMs: 1_000,
      fetchImpl,
      target: null,
      visibility: null,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    disconnect()
  })

  it("reconnects when a cleanly-ended stream closes, since the daemon re-sends the generation on connect", async () => {
    vi.useFakeTimers()
    const source = controllableStream()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(streamResponse(source.stream))
      .mockRejectedValue(new Error("refused"))

    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      initialDelayMs: 1_000,
      fetchImpl,
      target: null,
      visibility: null,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    source.end()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    disconnect()
  })

  it("never reconnects after cleanup, even when a failure is already in flight", async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn().mockRejectedValue(new Error("refused"))

    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      initialDelayMs: 1_000,
      fetchImpl,
      target: null,
      visibility: null,
    })

    await vi.advanceTimersByTimeAsync(0)
    disconnect()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it("refreshes and reconnects immediately when the network comes back, skipping the remaining backoff", async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const fetchImpl = vi.fn().mockRejectedValue(new Error("refused"))
    const onChanged = vi.fn()

    const disconnect = connectDaemonEvents({
      onChanged,
      debounceMs: 250,
      initialDelayMs: 30_000,
      fetchImpl,
      target,
      visibility: null,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    target.dispatchEvent(new Event("online"))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(250)
    expect(onChanged).toHaveBeenCalledTimes(1)

    disconnect()
  })

  it("refreshes and reconnects when the tab becomes visible, and does nothing when it is hidden", async () => {
    vi.useFakeTimers()
    const visibility = Object.assign(new EventTarget(), {
      visibilityState: "hidden",
    })
    const fetchImpl = vi.fn().mockRejectedValue(new Error("refused"))
    const onChanged = vi.fn()

    const disconnect = connectDaemonEvents({
      onChanged,
      debounceMs: 250,
      initialDelayMs: 30_000,
      fetchImpl,
      target: null,
      visibility,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    // Hidden: a visibilitychange that isn't a *return* changes nothing.
    visibility.dispatchEvent(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    visibility.visibilityState = "visible"
    visibility.dispatchEvent(new Event("visibilitychange"))
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(250)
    expect(onChanged).toHaveBeenCalledTimes(1)

    disconnect()
  })

  it("does not stack a second connection when already connected", async () => {
    vi.useFakeTimers()
    const target = new EventTarget()
    const source = controllableStream()
    const fetchImpl = vi.fn().mockResolvedValue(streamResponse(source.stream))

    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      fetchImpl,
      target,
      visibility: null,
    })

    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    target.dispatchEvent(new Event("online"))
    target.dispatchEvent(new Event("online"))
    await vi.advanceTimersByTimeAsync(0)

    expect(fetchImpl).toHaveBeenCalledTimes(1)

    disconnect()
  })

  it("no-ops without throwing when fetch isn't available", () => {
    vi.stubGlobal("fetch", undefined)
    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      target: null,
      visibility: null,
    })
    expect(() => disconnect()).not.toThrow()
  })
})
