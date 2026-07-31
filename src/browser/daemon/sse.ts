import { API_BASE } from "./client"

/**
 * One dispatched server-sent event.
 *
 * `data` is the concatenation of the frame's `data:` lines, newline-joined, as
 * the SSE grammar specifies. Nothing here parses it: the daemon's `changed`
 * event is a notification, not a payload — the client re-reads the tree rather
 * than trusting a diff it was handed.
 */
export interface SseEvent {
  type: string
  data: string
}

/**
 * An incremental server-sent-events parser.
 *
 * `push()` may be handed *any* slice of the stream: a partial line, several
 * frames at once, or a single byte. Bytes are held until a line terminator
 * arrives, so a field split across two network chunks — the normal case for
 * anything larger than one packet — reassembles instead of being dropped or
 * dispatched twice. All three terminators in the grammar are honoured (`\n`,
 * `\r\n`, and a lone `\r`); a trailing `\r` at the end of a chunk is held back
 * until the next chunk shows whether an `\n` follows it.
 *
 * Comment lines (`: keepalive`) are consumed and dispatch nothing, which is
 * what keeps a heartbeat from looking like a change. `retry:` is ignored on
 * purpose — reconnect timing is owned by {@link connectDaemonEvents}, which
 * has to be able to guarantee its own bounds.
 */
export function createSseParser(onEvent: (event: SseEvent) => void): {
  push(chunk: string): void
} {
  let buffer = ""
  let eventType = ""
  let dataLines: string[] = []

  function dispatch() {
    // A blank line with nothing accumulated is a frame separator, not an
    // event; dispatching one would turn every keepalive gap into a refresh.
    if (eventType === "" && dataLines.length === 0) return
    const type = eventType === "" ? "message" : eventType
    const data = dataLines.join("\n")
    eventType = ""
    dataLines = []
    onEvent({ type, data })
  }

  function handleLine(line: string) {
    if (line === "") {
      dispatch()
      return
    }
    if (line.startsWith(":")) return

    const colon = line.indexOf(":")
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? "" : line.slice(colon + 1)
    if (value.startsWith(" ")) value = value.slice(1)

    if (field === "event") {
      eventType = value
    } else if (field === "data") {
      dataLines.push(value)
    }
    // `id` and `retry` are accepted and ignored: there is no Last-Event-ID
    // replay to resume (the daemon re-sends the current generation on connect)
    // and reconnect timing is ours.
  }

  return {
    push(chunk: string) {
      buffer += chunk
      for (;;) {
        const lf = buffer.indexOf("\n")
        const cr = buffer.indexOf("\r")
        if (lf === -1 && cr === -1) break

        if (cr !== -1 && (lf === -1 || cr < lf)) {
          // Can't tell a lone CR from the first half of a CRLF until the byte
          // after it exists.
          if (cr === buffer.length - 1) break
          const line = buffer.slice(0, cr)
          buffer = buffer.slice(buffer[cr + 1] === "\n" ? cr + 2 : cr + 1)
          handleLine(line)
        } else {
          const line = buffer.slice(0, lf)
          buffer = buffer.slice(lf + 1)
          handleLine(line)
        }
      }
    },
  }
}

export interface DaemonEventsOptions {
  onChanged: () => void
  /** Defaults to the same-origin events path, which is what the served UI wants. */
  url?: string
  /** Extra request headers — in practice `Authorization`, from `DaemonClient.authHeaders()`. */
  headers?: Record<string, string>
  debounceMs?: number
  initialDelayMs?: number
  maxDelayMs?: number
  /** Test-only seam: inject a fetch implementation. */
  fetchImpl?: typeof fetch
  /** Test-only seam: inject the object carrying `online`/`visibilitychange`. */
  target?: EventTarget | null
  /** Test-only seam: inject the document whose `visibilityState` is read. */
  visibility?: { visibilityState?: string } | null
}

/**
 * Subscribes to the daemon's SSE `changed` event over `fetch`, debouncing
 * bursts into a single refresh.
 *
 * `EventSource` cannot carry an `Authorization` header — the API has no way to
 * set one — so the only way to authenticate a stream with it is to put the
 * credential in the query string, where it lands in the daemon's request log
 * and the browser's history. Reading the response body as a stream instead
 * costs an incremental parser and buys the same header pipeline every other
 * request already uses. Nothing is authenticated yet; this is what makes it
 * possible to be later without touching this file again.
 *
 * Reconnects with a bounded exponential backoff (1s doubling to 30s), reset
 * the moment a connection is actually established rather than when one is
 * merely attempted. A stream that ends cleanly is reconnected too: the daemon
 * re-sends the current generation on connect, so a reconnect is self-correcting
 * and cannot miss a change that happened while the stream was down.
 *
 * Returns a cleanup function that must be called on unmount/StrictMode
 * teardown; it aborts the in-flight request, drops every pending timer and
 * unregisters the visibility/online listeners.
 */
export function connectDaemonEvents(options: DaemonEventsOptions): () => void {
  const {
    onChanged,
    url = `${API_BASE}/events`,
    headers = {},
    debounceMs = 250,
    initialDelayMs = 1_000,
    maxDelayMs = 30_000,
    fetchImpl,
    target = typeof globalThis.addEventListener === "function"
      ? globalThis
      : null,
    visibility = typeof document !== "undefined" ? document : null,
  } = options

  const doFetch = fetchImpl ?? globalThis.fetch
  if (typeof doFetch !== "function") {
    return () => {}
  }

  let closed = false
  let controller: AbortController | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let delay = initialDelayMs

  function scheduleRefresh() {
    if (closed) return
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
      void connect()
    }, currentDelay)
  }

  async function connect(): Promise<void> {
    if (closed) return
    const abort = new AbortController()
    controller = abort

    try {
      const response = await doFetch.call(globalThis, url, {
        method: "GET",
        signal: abort.signal,
        cache: "no-store",
        headers: { Accept: "text/event-stream", ...headers },
      })

      if (!response.ok || !response.body) {
        throw new Error(`events stream refused with ${response.status}`)
      }

      // Connected, not merely attempted: a daemon that accepts and then drops
      // the stream still gets a full backoff ladder on the *next* failure,
      // while a daemon that was briefly restarting is picked up in 1s.
      delay = initialDelayMs

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      const parser = createSseParser((event) => {
        if (event.type === "changed") scheduleRefresh()
      })

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parser.push(decoder.decode(value, { stream: true }))
      }
    } catch {
      // Includes the abort thrown by dispose(), which the guard below filters.
    } finally {
      if (controller === abort) controller = null
      if (!closed && !abort.signal.aborted) scheduleReconnect()
    }
  }

  /**
   * Reconnects now rather than waiting out a backoff that was measured against
   * a condition — asleep, offline — that has just changed.
   */
  function reconnectNow() {
    if (closed || controller) return
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    delay = initialDelayMs
    void connect()
  }

  function handleVisible() {
    if (visibility && visibility.visibilityState !== "visible") return
    // A backgrounded tab may have had its stream torn down without an error
    // ever being delivered, so the tree it is showing can be arbitrarily old:
    // refresh as well as reconnect.
    scheduleRefresh()
    reconnectNow()
  }

  function handleOnline() {
    scheduleRefresh()
    reconnectNow()
  }

  target?.addEventListener("online", handleOnline)
  ;(visibility as EventTarget | null)?.addEventListener?.(
    "visibilitychange",
    handleVisible
  )

  void connect()

  return () => {
    closed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (debounceTimer) clearTimeout(debounceTimer)
    reconnectTimer = null
    debounceTimer = null
    controller?.abort()
    controller = null
    target?.removeEventListener("online", handleOnline)
    ;(visibility as EventTarget | null)?.removeEventListener?.(
      "visibilitychange",
      handleVisible
    )
  }
}
