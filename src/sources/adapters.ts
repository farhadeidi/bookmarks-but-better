/**
 * Building the concrete adapter for one source. This is the only module
 * outside `src/browser/*` that knows which concrete adapter class backs which
 * source kind — everything above it works in terms of `BrowserAdapter` and
 * capability flags.
 */

import type { BrowserAdapter } from "@/browser/types"
import { ChromeBookmarkAdapter } from "@/browser/chrome/bookmarks"
import { ChromeStorageAdapter } from "@/browser/chrome/storage"
import { ChromeFaviconAdapter } from "@/browser/chrome/favicon"
import { FirefoxBookmarkAdapter } from "@/browser/firefox/bookmarks"
import { FirefoxStorageAdapter } from "@/browser/firefox/storage"
import { FirefoxFaviconAdapter } from "@/browser/firefox/favicon"
import { StandaloneBookmarkAdapter } from "@/browser/standalone/bookmarks"
import { StandaloneStorageAdapter } from "@/browser/standalone/storage"
import { StandaloneFaviconAdapter } from "@/browser/standalone/favicon"
import { createExtensionDaemonAdapter } from "@/browser/daemon"
import type { SourceDescriptor } from "./descriptors"

function createChromeAdapter(): BrowserAdapter {
  return {
    bookmarks: new ChromeBookmarkAdapter(),
    storage: new ChromeStorageAdapter(),
    favicon: new ChromeFaviconAdapter(),
    capabilities: {
      openInManager: true,
      move: true,
      reorder: true,
      // Ordering here travels on `move(id, {index})`; there is no
      // whole-folder ordering endpoint to replace it.
      setChildOrder: false,
      // Chrome rejects parentId "0" ("Can't modify the root bookmark
      // folders"); a real child folder (e.g. the Bookmarks Bar) is required.
      rootIsCreatable: false,
    },
  }
}

function createFirefoxAdapter(): BrowserAdapter {
  return {
    bookmarks: new FirefoxBookmarkAdapter(),
    storage: new FirefoxStorageAdapter(),
    favicon: new FirefoxFaviconAdapter(),
    capabilities: {
      openInManager: false,
      move: true,
      reorder: true,
      // Ordering here travels on `move(id, {index})`; there is no
      // whole-folder ordering endpoint to replace it.
      setChildOrder: false,
      // Same WebExtensions bookmarks API as Chrome, same synthetic root.
      rootIsCreatable: false,
    },
  }
}

/**
 * The Standalone adapter, kept whole behind one factory. The sunset means
 * this is the single place a later major version has to delete to remove the
 * source: nothing else constructs it.
 */
export function createStandaloneAdapter(): BrowserAdapter {
  return {
    bookmarks: new StandaloneBookmarkAdapter(),
    storage: new StandaloneStorageAdapter(),
    favicon: new StandaloneFaviconAdapter(),
    capabilities: {
      openInManager: false,
      move: true,
      reorder: true,
      // Ordering here travels on `move(id, {index})`; there is no
      // whole-folder ordering endpoint to replace it.
      setChildOrder: false,
      // `getTree()` wraps the stored rows in a synthetic root
      // (`STANDALONE_ROOT_ID`) that `create()` accepts as a parent and maps
      // back to "no parentId", so `tree[0]` really is a creatable folder here.
      rootIsCreatable: true,
    },
  }
}

/**
 * Whether this extension context is Gecko's. Firefox exposes the same
 * WebExtensions surface under both global names, so the build target — not a
 * runtime probe — is the honest discriminator; but the adapters module reads
 * it through the user agent so a Firefox build loaded unprivileged (a dev
 * server) still picks the Chromium adapters that match what actually exists.
 */
function detectGecko(): boolean {
  if (typeof navigator === "undefined" || !navigator.userAgent) return false
  return /Firefox\b/.test(navigator.userAgent)
}

/** The connection details a daemon source builds its client from. */
export interface DaemonConnectionDetails {
  origin: string
  bearerToken?: string
}

/**
 * The adapter for one source.
 *
 * `connections` maps each daemon origin to its stored credentials; the served
 * daemon app's same-origin sources pass an origin of `""` and find no entry,
 * which is exactly right — same-origin requests need none.
 */
export function createAdapterForSource(
  source: SourceDescriptor,
  connections: Record<string, { bearerToken?: string }> = {}
): BrowserAdapter {
  switch (source.kind) {
    case "browser":
      return detectGecko() ? createFirefoxAdapter() : createChromeAdapter()
    case "standalone":
      return createStandaloneAdapter()
    case "daemon": {
      const connection: DaemonConnectionDetails = {
        origin: source.origin ?? "",
        ...(connections[source.origin ?? ""]?.bearerToken
          ? { bearerToken: connections[source.origin ?? ""]?.bearerToken }
          : {}),
      }
      // A daemon that predates Vault ids is reached unscoped: scoping would
      // aim every request at a route it does not serve.
      const vaultId = source.unscoped ? null : (source.vaultId ?? null)
      return createExtensionDaemonAdapter(connection, vaultId)
    }
  }
}
