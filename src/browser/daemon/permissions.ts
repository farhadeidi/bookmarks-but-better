/**
 * The optional host permission an extension needs to reach a daemon, and
 * nothing about it is granted until the user asks to connect.
 *
 * Both manifests declare these under `optional_host_permissions`, not
 * `host_permissions` — installing (or updating) the extension therefore asks
 * for nothing beyond `bookmarks` / `storage` / `favicon` until someone
 * actually clicks Connect in the settings dialog. A match pattern covers its
 * host on any port, so one entry per host (`127.0.0.1`, `localhost` — the
 * only two `canonicalizeDaemonOrigin` accepts) is enough regardless of which
 * port the user configures.
 */
const DAEMON_HOST_PATTERNS = ["http://127.0.0.1/*", "http://localhost/*"]

function permissionsApi(): typeof chrome.permissions | undefined {
  try {
    return typeof chrome !== "undefined" ? chrome.permissions : undefined
  } catch {
    return undefined
  }
}

/**
 * Whether the daemon's host permission is already granted.
 *
 * `true` outside an extension context (no `chrome.permissions` API to ask —
 * the daemon-served build and the standalone web app have no permission
 * model at all, and a fetch to loopback there is not gated by one).
 */
export async function hasDaemonHostPermission(): Promise<boolean> {
  const api = permissionsApi()
  if (!api) return true
  return new Promise((resolve) => {
    try {
      api.contains({ origins: DAEMON_HOST_PATTERNS }, (granted) =>
        resolve(Boolean(granted))
      )
    } catch {
      resolve(false)
    }
  })
}

/**
 * Requests the daemon's host permission if it is not already granted.
 *
 * Must be called synchronously from a user gesture — the Connect button's own
 * click handler — since every browser refuses `permissions.request` outside
 * one. Resolves to whether the extension may now reach the daemon; the
 * caller must treat `false` as a hard stop and never fall through to a
 * network request, a request that then failed as blocked-by-the-browser
 * would be indistinguishable from an unreachable daemon and misreport the
 * cause.
 *
 * There is deliberately **no `contains()` pre-check** in front of the request.
 * Awaiting one resumes in a later task, and Firefox decides "is this a user
 * input handler?" from the synchronous call stack — so the pre-check would
 * turn every Connect on Firefox into `permissions.request may only be called
 * from a user input handler`, which this function would then report as a
 * denial the user never made. `request` already resolves `true` without
 * showing anything when the permission is held, so the pre-check bought
 * nothing and cost the gesture. Everything from the click down to the line
 * below must stay await-free for the same reason.
 */
export async function requestDaemonHostPermission(): Promise<boolean> {
  const api = permissionsApi()
  if (!api) return true
  return new Promise((resolve) => {
    try {
      api.request({ origins: DAEMON_HOST_PATTERNS }, (granted) =>
        resolve(Boolean(granted))
      )
    } catch {
      resolve(false)
    }
  })
}

/** Releases the daemon's host permission. Used by "Forget". */
export async function removeDaemonHostPermission(): Promise<void> {
  const api = permissionsApi()
  if (!api) return
  await new Promise<void>((resolve) => {
    try {
      api.remove({ origins: DAEMON_HOST_PATTERNS }, () => resolve())
    } catch {
      resolve()
    }
  })
}
