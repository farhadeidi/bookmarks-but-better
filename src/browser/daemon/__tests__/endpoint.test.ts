import { describe, expect, it } from "vitest"
import {
  DEFAULT_DAEMON_ORIGIN,
  DEFAULT_DAEMON_PORT,
  DaemonEndpointError,
  canonicalizeDaemonOrigin,
  tryCanonicalizeDaemonOrigin,
} from "../endpoint"

describe("canonicalizeDaemonOrigin", () => {
  it("defaults to port 52222", () => {
    expect(DEFAULT_DAEMON_PORT).toBe(52222)
    expect(DEFAULT_DAEMON_ORIGIN).toBe("http://127.0.0.1:52222")
    expect(canonicalizeDaemonOrigin(DEFAULT_DAEMON_ORIGIN)).toBe(
      DEFAULT_DAEMON_ORIGIN
    )
  })

  const accepted: Array<[string, string]> = [
    ["http://127.0.0.1:52222", "http://127.0.0.1:52222"],
    ["http://localhost:52222", "http://localhost:52222"],
    // A bare authority is read as http rather than rejected: it is what a user
    // copies out of a terminal.
    ["127.0.0.1:52222", "http://127.0.0.1:52222"],
    ["localhost:52222", "http://localhost:52222"],
    // A missing port means the daemon's default, not HTTP's 80.
    ["http://127.0.0.1", "http://127.0.0.1:52222"],
    ["localhost", "http://localhost:52222"],
    // A bare `/` is the origin's own root, so it is dropped rather than refused.
    ["http://127.0.0.1:52222/", "http://127.0.0.1:52222"],
    // Case and surrounding whitespace normalize away.
    ["  HTTP://LocalHost:52222  ", "http://localhost:52222"],
    // An explicit port always survives, including one that is HTTP's default
    // and would otherwise vanish through `new URL().port`.
    ["http://127.0.0.1:80", "http://127.0.0.1:80"],
    ["http://127.0.0.1:1", "http://127.0.0.1:1"],
    ["http://127.0.0.1:65535", "http://127.0.0.1:65535"],
    // The port existing installs were explicitly configured on stays usable.
    ["http://127.0.0.1:47321", "http://127.0.0.1:47321"],
  ]

  for (const [input, expected] of accepted) {
    it(`accepts ${JSON.stringify(input)} as ${expected}`, () => {
      expect(canonicalizeDaemonOrigin(input)).toBe(expected)
    })
  }

  it("is idempotent, so a stored origin compares equal to itself", () => {
    for (const [, expected] of accepted) {
      expect(canonicalizeDaemonOrigin(expected)).toBe(expected)
    }
  })

  const rejected: Array<[string, string]> = [
    ["", "empty"],
    ["   ", "empty"],
    // TLS on loopback would need a certificate the daemon cannot obtain.
    ["https://127.0.0.1:52222", "scheme"],
    ["ws://127.0.0.1:52222", "scheme"],
    ["file:///etc/passwd", "scheme"],
    // Anything that is not loopback, including addresses that merely look local.
    ["http://192.168.1.10:52222", "host"],
    ["http://10.0.0.5:52222", "host"],
    ["http://172.16.0.1:52222", "host"],
    ["http://0.0.0.0:52222", "host"],
    ["http://example.com:52222", "host"],
    ["http://bookmarks.local:52222", "host"],
    // Another 127/8 address and the IPv6 loopback: reachable in principle, but
    // a second spelling of one endpoint breaks string comparison of origins.
    ["http://127.0.0.2:52222", "host"],
    ["http://[::1]:52222", "host"],
    ["http://:52222", "host"],
    // Port 0 means "any free port" to a listener; as a destination it is nothing.
    ["http://127.0.0.1:0", "port"],
    ["http://127.0.0.1:65536", "port"],
    ["http://127.0.0.1:99999", "port"],
    ["http://127.0.0.1:", "port"],
    ["http://127.0.0.1:abc", "port"],
    ["http://127.0.0.1:-1", "port"],
    ["http://127.0.0.1:52222.5", "port"],
    // Credentials would be sent on every request and shown in every error.
    ["http://user:pass@127.0.0.1:52222", "credentials"],
    ["http://user@127.0.0.1:52222", "credentials"],
    // A path, query or fragment would either be dropped silently or smuggle
    // state into a value that is supposed to be comparable by equality.
    ["http://127.0.0.1:52222/api/v1", "path"],
    ["http://127.0.0.1:52222/vault", "path"],
    ["http://127.0.0.1:52222?token=abc", "query"],
    ["http://127.0.0.1:52222/#frag", "fragment"],
  ]

  for (const [input, reason] of rejected) {
    it(`rejects ${JSON.stringify(input)} as ${reason}`, () => {
      expect(() => canonicalizeDaemonOrigin(input)).toThrow(DaemonEndpointError)
      try {
        canonicalizeDaemonOrigin(input)
        throw new Error("should have thrown")
      } catch (error) {
        expect((error as DaemonEndpointError).reason).toBe(reason)
      }
    })
  }

  it("never returns a non-loopback origin for any rejected input", () => {
    for (const [input] of rejected) {
      const result = tryCanonicalizeDaemonOrigin(input)
      expect(result.ok).toBe(false)
    }
  })
})

describe("tryCanonicalizeDaemonOrigin", () => {
  it("returns the canonical origin on success", () => {
    expect(tryCanonicalizeDaemonOrigin("127.0.0.1")).toEqual({
      ok: true,
      origin: "http://127.0.0.1:52222",
    })
  })

  it("returns a reason and a renderable message on failure", () => {
    const result = tryCanonicalizeDaemonOrigin("https://example.com")
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("unreachable")
    expect(result.reason).toBe("scheme")
    expect(result.message.length).toBeGreaterThan(0)
  })
})
