/**
 * The platform seam: what this build and this runtime can do.
 *
 * Product code asks these questions instead of naming a browser, so a new
 * target is a new row here (and a build manifest) rather than `if safari`
 * branches scattered through features. The two questions the source model
 * needs are whether a Browser Source exists at all (Safari has no
 * WebExtensions bookmarks API) and whether the omnibox integration exists
 * (Safari has none). The daemon-served web app answers both with `false` too:
 * it is a client of a daemon, not an extension.
 */

export type BuildTarget = "chrome" | "firefox" | "safari" | "daemon"

export interface PlatformCapabilities {
  /** Which bundle this is. Never branched on outside platform wiring. */
  buildTarget: BuildTarget
  /** Whether the Browser Source exists here at all. False on Safari builds. */
  browserSource: boolean
  /** Whether the omnibox keyword integration exists. */
  omnibox: boolean
  /**
   * Whether this build replaces the browser's new tab page.
   *
   * The question behind it is "does the dashboard show up on its own?". Where
   * it does, installing the extension is enough — the next new tab is the
   * dashboard and the setup wizard runs there. Where it does not, nothing
   * happens after an install unless something opens it, which is what the
   * background worker uses this to decide.
   */
  newTabOverride: boolean
  /** Whether this runs as a browser extension (dashboard + popup + worker). */
  isExtension: boolean
  /** Whether daemon sources can be connected from this client. */
  daemonSource: boolean
}

function buildTarget(): BuildTarget {
  const target: unknown = import.meta.env.VITE_BUILD_TARGET
  switch (target) {
    case "chrome":
    case "firefox":
    case "safari":
    case "daemon":
      return target
    default:
      return "chrome"
  }
}

function hasBrowserBookmarksApi(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      typeof chrome.bookmarks !== "undefined" &&
      typeof chrome.storage !== "undefined"
    )
  } catch {
    return false
  }
}

function hasOmniboxApi(): boolean {
  try {
    return (
      typeof chrome !== "undefined" && typeof chrome.omnibox !== "undefined"
    )
  } catch {
    return false
  }
}

/**
 * Whether this page runs inside an extension context at all. Safari's
 * WebExtensions surface neither `chrome.bookmarks` nor `chrome.omnibox`, so
 * the runtime id is the honest marker there — and on every other target it
 * is present exactly when the page is the extension's own.
 */
function hasExtensionRuntime(): boolean {
  try {
    return (
      typeof chrome !== "undefined" &&
      typeof chrome.runtime !== "undefined" &&
      typeof chrome.runtime.id === "string"
    )
  } catch {
    return false
  }
}

/**
 * The capabilities a non-production SourceEnvironment (the Dev Workbench)
 * installs so every surface asking capability questions sees the scenario's
 * world instead of this browser's. Production never sets it; the seam that
 * owns capabilities is the one place that does.
 */
let override: PlatformCapabilities | null = null

/** Installs (or clears) the environment's capability answer. */
export function setPlatformCapabilities(
  caps: PlatformCapabilities | null
): void {
  override = caps
}

/**
 * The capabilities of this build and runtime, resolved once per load.
 *
 * Runtime presence (`chrome.bookmarks` existing) is checked alongside the
 * build target so a dev server running the extension bundles outside a
 * browser degrades the same way Safari does — by omitting the capability,
 * not by crashing on a missing API.
 */
export function platformCapabilities(): PlatformCapabilities {
  if (override) return override
  return computedPlatformCapabilities()
}

function computedPlatformCapabilities(): PlatformCapabilities {
  const target = buildTarget()

  if (target === "daemon") {
    return {
      buildTarget: target,
      browserSource: false,
      omnibox: false,
      // The daemon serves this app at a URL; it replaces no new tab page.
      newTabOverride: false,
      isExtension: false,
      daemonSource: true,
    }
  }

  const isExtension =
    hasBrowserBookmarksApi() || hasOmniboxApi() || hasExtensionRuntime()
  // A browser whose WebExtensions implementation lacks the bookmarks API has
  // no Browser Source, whatever its name. This is Safari's situation, and
  // the check keeps the guard honest in any runtime that matches it.
  const browserSource = target !== "safari" && hasBrowserBookmarksApi()

  return {
    buildTarget: target,
    browserSource,
    omnibox: hasOmniboxApi(),
    // Safari's WebExtensions implementation supports no new-tab override, so
    // its manifest declares none — see `manifests/manifest.safari.json` and
    // the contract test that pins its absence. Chrome and Firefox do, and
    // their manifests claim it.
    newTabOverride: target !== "safari",
    isExtension,
    // Firefox for Android cannot reach a same-machine daemon; desktop
    // extension builds and plain web builds can.
    daemonSource: isDaemonModeSupportedRuntime(),
  }
}

/**
 * Whether a daemon is reachable from this runtime at all.
 *
 * Kept private to platform wiring: callers consume `daemonSource` above.
 * A `bookmarks-but-better` daemon is a native background process on the *same
 * machine* the browser runs on. Firefox for Android — the only mobile browser
 * with extension support in these builds — cannot run one and has no loopback
 * service to reach, so offering a connection UI there would be a dead end.
 */
function isDaemonModeSupportedRuntime(): boolean {
  if (typeof navigator === "undefined" || !navigator.userAgent) return true
  return !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
}
