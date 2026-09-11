import type { FaviconProvider } from "../types"
import { GoogleFaviconV2Provider } from "../favicon/google-favicon-v2"
import { ChromeFaviconProvider } from "../favicon/chrome-favicon"

const googleV2 = new GoogleFaviconV2Provider()
const chromeFavicon = new ChromeFaviconProvider()

/**
 * Google first, Chrome's own `_favicon` as the fallback.
 *
 * The order was the other way round from the day the favicon cache landed,
 * because a `_favicon` hit is answered on the extension's own origin out of
 * the browser's icon database and tells nobody anything. It went back because
 * desktop Chrome cannot supply the icon the dashboard needs. Its favicon
 * handler keeps only the 16-dip icon at each supported scale — 16 and 32
 * pixels — and `_favicon` fills any other requested size by resizing that.
 * When the request is an integer multiple of what it holds, as `size=64` is
 * of both, it samples nearest-neighbour (Chromium's
 * `select_favicon_frames.cc`, `GetResizedBitmap`), so a grid tile drawn at 40
 * CSS pixels on a 2x display got a 32-pixel icon blown up into visible blocks.
 * The response is always 64×64, so nothing about it — not even decoding it —
 * reveals what it was scaled from; there is no quality check that could keep
 * `_favicon` first and fall through only when it is not good enough. Google's
 * service returns the site's larger icons at their real size, which is what
 * sharp icons have meant since 64-pixel requests were introduced.
 *
 * What `_favicon` is still good for is a site Google has nothing for: one
 * visited in this profile but unknown to Google's crawl, or one Google answers
 * with its generic globe. The resolver recognizes `_favicon`'s own placeholder
 * by sampling it (see `getPlaceholderProbeUrl`), so a miss there still ends at
 * the letter rather than at Chrome's default page icon.
 *
 * The privacy cost is bounded by the cache rather than by this order: Google's
 * bytes are readable here (`host_permissions` grants gstatic), so an origin is
 * disclosed about once a month, not on every render.
 */
export class ChromeFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return googleV2.getUrl(pageUrl)
  }

  getFallbackUrl(pageUrl: string): string {
    if (chromeFavicon.isAvailable()) {
      return chromeFavicon.getUrl(pageUrl)
    }
    return ""
  }

  getPlaceholderProbeUrl(): string {
    return chromeFavicon.getPlaceholderProbeUrl()
  }

  isAvailable(): boolean {
    return true
  }
}
