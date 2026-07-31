/**
 * Canonicalization of the one address an extension may point a daemon client
 * at.
 *
 * The daemon binds loopback and refuses any request whose `Host` is not a
 * loopback name, so a non-loopback endpoint could never work anyway. This
 * module exists so the *client* refuses it too, at the moment the user types
 * it, rather than turning a typo into a cross-origin request the browser then
 * has to block. A rejected endpoint is never stored, so nothing can later read
 * a LAN address back out of preferences and connect to it.
 *
 * Deliberately stricter than `new URL()`:
 *
 * * `http` only — TLS on loopback would need a certificate the daemon has no
 *   way to obtain, so `https` is a mistake, not a stricter alternative.
 * * The host is exactly `127.0.0.1` or `localhost`. Not `::1` (a Host guard
 *   match is not the point — one spelling per address keeps the stored value
 *   comparable), not another 127/8 address, not a hostname that happens to
 *   resolve to loopback today.
 * * A port is a decimal 1–65535. Port 0 means "ask the OS for a free one",
 *   which is meaningless as a destination.
 * * No credentials, no path other than `/`, no query, no fragment. Each of
 *   those would either be silently dropped or smuggle state into an origin
 *   that is supposed to be comparable by string equality.
 *
 * The canonical form is always `http://<host>:<port>` with no trailing slash,
 * so two spellings of the same endpoint compare equal.
 */

/** The port the daemon listens on unless told otherwise. */
export const DEFAULT_DAEMON_PORT = 52222

/** The endpoint an extension uses unless the user configures another one. */
export const DEFAULT_DAEMON_ORIGIN = `http://127.0.0.1:${DEFAULT_DAEMON_PORT}`

/** Why an endpoint was refused. Stable enough for a UI to switch on. */
export type DaemonEndpointRejection =
  | "empty"
  | "scheme"
  | "credentials"
  | "host"
  | "port"
  | "path"
  | "query"
  | "fragment"

/** An endpoint that cannot be used, with a reason a settings form can render. */
export class DaemonEndpointError extends Error {
  readonly reason: DaemonEndpointRejection

  constructor(reason: DaemonEndpointRejection, message: string) {
    super(message)
    this.name = "DaemonEndpointError"
    this.reason = reason
  }
}

const HOSTS = new Set(["127.0.0.1", "localhost"])

/** Matches a leading `scheme://`, so a bare `localhost:52222` is not read as a scheme. */
const SCHEME = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\//

function reject(reason: DaemonEndpointRejection, message: string): never {
  throw new DaemonEndpointError(reason, message)
}

/**
 * Returns the canonical `http://host:port` form of `input`.
 *
 * A bare authority (`127.0.0.1:52222`, `localhost`) is accepted and read as
 * `http://`; anything that does carry a scheme must carry `http`. A missing
 * port means {@link DEFAULT_DAEMON_PORT} — the daemon's own default, not
 * HTTP's 80, since 80 is never where the daemon is.
 *
 * @throws {DaemonEndpointError} when the endpoint is not a usable loopback origin.
 */
export function canonicalizeDaemonOrigin(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    reject("empty", "Enter a daemon address, for example 127.0.0.1:52222.")
  }

  const scheme = SCHEME.exec(trimmed)
  if (scheme && scheme[1].toLowerCase() !== "http") {
    reject(
      "scheme",
      `${scheme[1]}:// is not supported — the daemon serves plain http on loopback.`
    )
  }
  const rest = scheme ? trimmed.slice(scheme[0].length) : trimmed

  // Fragment and query are checked before the path split so that
  // `127.0.0.1:52222?x=1` reports "query" rather than being read as a host.
  if (rest.includes("#")) {
    reject("fragment", "A daemon address cannot carry a #fragment.")
  }
  if (rest.includes("?")) {
    reject("query", "A daemon address cannot carry a ?query string.")
  }

  const slash = rest.indexOf("/")
  const authority = slash === -1 ? rest : rest.slice(0, slash)
  const path = slash === -1 ? "" : rest.slice(slash)
  if (path !== "" && path !== "/") {
    reject("path", "A daemon address cannot include a path.")
  }

  if (authority.includes("@")) {
    reject(
      "credentials",
      "A daemon address cannot include a username or password."
    )
  }
  if (authority.startsWith("[")) {
    // An IPv6 literal. `::1` is loopback, but allowing two spellings of one
    // endpoint would make stored origins incomparable by string equality.
    reject("host", "Use 127.0.0.1 or localhost rather than an IPv6 literal.")
  }

  const colon = authority.lastIndexOf(":")
  const host = colon === -1 ? authority : authority.slice(0, colon)
  const portText = colon === -1 ? undefined : authority.slice(colon + 1)

  const lowered = host.toLowerCase()
  if (!HOSTS.has(lowered)) {
    reject(
      "host",
      `${host || "That address"} is not loopback — the daemon is only reachable at 127.0.0.1 or localhost.`
    )
  }

  let port = DEFAULT_DAEMON_PORT
  if (portText !== undefined) {
    if (!/^\d{1,5}$/.test(portText)) {
      reject("port", `${portText || "An empty value"} is not a port number.`)
    }
    port = Number(portText)
    if (port < 1 || port > 65535) {
      reject("port", `Port ${port} is out of range — use 1 to 65535.`)
    }
  }

  return `http://${lowered}:${port}`
}

/** The non-throwing form, for a settings form validating as the user types. */
export type DaemonEndpointResult =
  | { ok: true; origin: string }
  | { ok: false; reason: DaemonEndpointRejection; message: string }

/** {@link canonicalizeDaemonOrigin} as a result rather than an exception. */
export function tryCanonicalizeDaemonOrigin(
  input: string
): DaemonEndpointResult {
  try {
    return { ok: true, origin: canonicalizeDaemonOrigin(input) }
  } catch (error) {
    if (error instanceof DaemonEndpointError) {
      return { ok: false, reason: error.reason, message: error.message }
    }
    throw error
  }
}
