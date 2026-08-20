import type { FaviconProvider } from "../types"
import { GoogleFaviconV2Provider } from "../favicon/google-favicon-v2"
import { GoogleFaviconProvider } from "../favicon/google-favicon"

const googleV2 = new GoogleFaviconV2Provider()
const googleFavicon = new GoogleFaviconProvider()

/**
 * Daemon-mode favicons come from Google's public favicon services — the same
 * two providers, in the same order, as the standalone adapter uses.
 *
 * PRIVACY TRADE-OFF, ACCEPTED DELIBERATELY. This adapter previously returned a
 * generated letter-avatar `data:` URI and made no network request at all, so
 * that a loopback-only vault never told a third party which hosts the user had
 * bookmarked. That is no longer true: rendering a bookmark sends its *origin*
 * to Google, and the set of origins one client asks for is, in aggregate, that
 * user's bookmark host list.
 *
 * The favicon cache narrows this, but does not close it, and the difference
 * matters. Where the app runs as an extension, `host_permissions` let the
 * resolver read Google's response and store the bytes, so an origin is
 * disclosed roughly once a month rather than on every render. The daemon's own
 * web app is served over loopback with no such grant: it cannot read the
 * response, only display it, so its Google requests keep happening — the cache
 * saves it only the requests for sites nobody has an icon for.
 *
 * What did *not* change is the daemon itself. It still binds loopback only and
 * still makes no outbound request of its own — the disclosure is made by the
 * browser rendering the UI, not by `bookmarks-but-better`. Closing the gap for
 * the served web app means a daemon-side proxy that fetches each site's own
 * icon, not a different third-party service.
 */
export class DaemonFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return googleV2.getUrl(pageUrl)
  }

  getFallbackUrl(pageUrl: string): string {
    return googleFavicon.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }
}
