import type { FaviconProvider } from "../types"
import { GoogleFaviconV2Provider } from "../favicon/google-favicon-v2"
import { ChromeFaviconProvider } from "../favicon/chrome-favicon"

const googleV2 = new GoogleFaviconV2Provider()
const chromeFavicon = new ChromeFaviconProvider()

export class ChromeFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return googleV2.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }

  getFallbackUrl(pageUrl: string): string {
    if (chromeFavicon.isAvailable()) {
      return chromeFavicon.getUrl(pageUrl)
    }
    return ""
  }
}
