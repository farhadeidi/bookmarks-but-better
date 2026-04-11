import type { FaviconProvider } from "../types"
import { GoogleFaviconV2Provider } from "../favicon/google-favicon-v2"

const googleV2 = new GoogleFaviconV2Provider()

/**
 * Firefox has no equivalent to Chrome's internal `_favicon` API, so Google Favicon V2
 * is the sole provider. `getFallbackUrl` is intentionally not implemented.
 */
export class FirefoxFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return googleV2.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }
}
