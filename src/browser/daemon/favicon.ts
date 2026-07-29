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
 * What did *not* change is the daemon itself. It still binds loopback only and
 * still makes no outbound request of its own — the disclosure is made by the
 * browser rendering the UI, not by `bbb`. Restoring the old no-disclosure
 * behaviour means a daemon-side proxy that fetches each site's own icon, not a
 * different third-party service.
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
