import { DAEMON_EVENTS_PATH } from "./client"

export interface DaemonEventsOptions {
  onChanged: () => void
  path?: string
  debounceMs?: number
  initialDelayMs?: number
  maxDelayMs?: number
  /** Test-only seam: inject a fake EventSource constructor. */
  EventSourceImpl?: typeof EventSource
}

/**
 * Subscribes to the daemon's SSE `changed` event, debouncing bursts into a
 * single refresh. Reconnects with a bounded exponential backoff instead of
 * relying on the browser's built-in (fixed-interval) EventSource retry,
 * which is why every error path closes the source before scheduling its own
 * reconnect timer.
 *
 * Returns a cleanup function that must be called on unmount/StrictMode
 * teardown so the connection and any pending timers don't leak.
 */
export function connectDaemonEvents(options: DaemonEventsOptions): () => void {
  const {
    onChanged,
    path = DAEMON_EVENTS_PATH,
    debounceMs = 250,
    initialDelayMs = 1_000,
    maxDelayMs = 30_000,
    EventSourceImpl = typeof EventSource !== "undefined"
      ? EventSource
      : undefined,
  } = options

  if (!EventSourceImpl) {
    return () => {}
  }
  const ES = EventSourceImpl

  let source: EventSource | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let delay = initialDelayMs
  let closed = false

  function scheduleRefresh() {
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      onChanged()
    }, debounceMs)
  }

  function scheduleReconnect() {
    if (closed || reconnectTimer) return
    const currentDelay = delay
    delay = Math.min(delay * 2, maxDelayMs)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, currentDelay)
  }

  function connect() {
    if (closed) return
    const es = new ES(path)
    source = es
    es.addEventListener("changed", scheduleRefresh)
    es.onopen = () => {
      delay = initialDelayMs
    }
    es.onerror = () => {
      es.close()
      if (source === es) source = null
      scheduleReconnect()
    }
  }

  connect()

  return () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (debounceTimer) clearTimeout(debounceTimer)
    source?.close()
    source = null
  }
}
