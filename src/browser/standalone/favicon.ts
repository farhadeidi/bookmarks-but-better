import type { FaviconProvider } from "../types"
import { GoogleFaviconV2Provider } from "../favicon/google-favicon-v2"
import { GoogleFaviconProvider } from "../favicon/google-favicon"

const googleV2 = new GoogleFaviconV2Provider()
const googleFavicon = new GoogleFaviconProvider()

export class StandaloneFaviconAdapter implements FaviconProvider {
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
