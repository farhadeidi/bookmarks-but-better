import type { FaviconProvider } from "../types"
import { GoogleFaviconV2Provider } from "../favicon/google-favicon-v2"
import { ChromeFaviconProvider } from "../favicon/chrome-favicon"

const googleV2 = new GoogleFaviconV2Provider()
const chromeFavicon = new ChromeFaviconProvider()

/**
 * Chrome asks itself first.
 *
 * The `_favicon` API answers out of the browser's own icon database, on the
 * extension's own origin, so a hit tells nobody anything — and because it is
 * same-origin, the favicon cache can read and store its bytes, which no
 * third-party provider's response allowed before this. This order used to be
 * the other way round, with Google primary and `_favicon` as the fallback;
 * flipping it is the whole privacy gain on Chrome, and it is safe only because
 * the resolver can now recognize `_favicon`'s placeholder (see
 * `getPlaceholderProbeUrl`) and move on to Google when Chrome has nothing.
 */
export class ChromeFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    if (chromeFavicon.isAvailable()) {
      return chromeFavicon.getUrl(pageUrl)
    }
    return googleV2.getUrl(pageUrl)
  }

  getFallbackUrl(pageUrl: string): string {
    return googleV2.getUrl(pageUrl)
  }

  getPlaceholderProbeUrl(): string {
    return chromeFavicon.getPlaceholderProbeUrl()
  }

  isAvailable(): boolean {
    return true
  }
}
