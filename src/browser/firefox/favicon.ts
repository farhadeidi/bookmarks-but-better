import type { FaviconProvider } from "../types"
import { GoogleFaviconV2Provider } from "../favicon/google-favicon-v2"

const googleV2 = new GoogleFaviconV2Provider()

/**
 * Firefox has no equivalent to Chrome's internal `_favicon` API, so Google
 * Favicon V2 is the sole provider. `getFallbackUrl` is intentionally not
 * implemented.
 *
 * The one native source Firefox does offer is `tabs.Tab.favIconUrl`, and it is
 * deliberately not used: reading it needs the `tabs` permission, which this
 * extension does not request. Adding it would buy icons for the handful of
 * sites that happen to be open at that moment, in exchange for a permission
 * that grants the URL and title of every tab — a worse privacy trade than the
 * one it would fix, and a store-review cost besides.
 *
 * Firefox still gains the rest of the cache: `host_permissions` already covers
 * `t1.gstatic.com`, so the resolver can read and store Google's bytes, and a
 * site resolved once is rendered locally from then on.
 */
export class FirefoxFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return googleV2.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }
}
