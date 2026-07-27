import { afterEach, describe, expect, it, vi } from "vitest"
import { connectDaemonEvents } from "../sse"

class FakeEventSource {
  static instances: FakeEventSource[] = []
  url: string
  closed = false
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  private listeners = new Map<string, Set<() => void>>()

  constructor(url: string) {
    this.url = url
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, cb: () => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set())
    this.listeners.get(type)!.add(cb)
  }

  close() {
    this.closed = true
  }

  emit(type: string) {
    for (const cb of this.listeners.get(type) ?? []) cb()
  }
}

function latestInstance(): FakeEventSource {
  const instance = FakeEventSource.instances.at(-1)
  if (!instance) throw new Error("no FakeEventSource instance created")
  return instance
}

afterEach(() => {
  FakeEventSource.instances = []
  vi.useRealTimers()
})

describe("connectDaemonEvents", () => {
  it("debounces bursts of `changed` events into a single refresh", () => {
    vi.useFakeTimers()
    const onChanged = vi.fn()

    connectDaemonEvents({
      onChanged,
      debounceMs: 250,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    })

    const source = latestInstance()
    source.emit("changed")
    vi.advanceTimersByTime(100)
    source.emit("changed")
    vi.advanceTimersByTime(100)
    source.emit("changed")

    expect(onChanged).not.toHaveBeenCalled()

    vi.advanceTimersByTime(250)
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it("closes the connection and stops all timers on cleanup, including a pending debounce", () => {
    vi.useFakeTimers()
    const onChanged = vi.fn()

    const disconnect = connectDaemonEvents({
      onChanged,
      debounceMs: 250,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    })

    const source = latestInstance()
    source.emit("changed")
    disconnect()

    expect(source.closed).toBe(true)
    vi.advanceTimersByTime(1_000)
    expect(onChanged).not.toHaveBeenCalled()
  })

  it("reconnects after an error with a bounded exponential backoff, resetting on a successful open", () => {
    vi.useFakeTimers()
    const onChanged = vi.fn()

    connectDaemonEvents({
      onChanged,
      initialDelayMs: 1_000,
      maxDelayMs: 4_000,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    })

    expect(FakeEventSource.instances).toHaveLength(1)

    // First error: closes the dead connection and reconnects after 1s.
    latestInstance().onerror?.()
    expect(latestInstance().closed).toBe(true)
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(2)

    // Second error before ever opening: backoff doubles to 2s, capped at 4s.
    latestInstance().onerror?.()
    vi.advanceTimersByTime(1_999)
    expect(FakeEventSource.instances).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(3)

    // A clean open resets the backoff back to the initial delay.
    latestInstance().onopen?.()
    latestInstance().onerror?.()
    vi.advanceTimersByTime(999)
    expect(FakeEventSource.instances).toHaveLength(3)
    vi.advanceTimersByTime(1)
    expect(FakeEventSource.instances).toHaveLength(4)
  })

  it("never reconnects after cleanup even if an in-flight error fires", () => {
    vi.useFakeTimers()
    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      initialDelayMs: 1_000,
      EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    })

    latestInstance().onerror?.()
    disconnect()
    vi.advanceTimersByTime(10_000)

    expect(FakeEventSource.instances).toHaveLength(1)
  })

  it("no-ops without throwing when EventSource isn't available", () => {
    const disconnect = connectDaemonEvents({
      onChanged: vi.fn(),
      EventSourceImpl: undefined,
    })

    expect(() => disconnect()).not.toThrow()
    expect(FakeEventSource.instances).toHaveLength(0)
  })
})
