import type { FaviconProvider } from "../types"
import { ChromeFaviconProvider } from "../favicon/chrome-favicon"
import { GoogleFaviconProvider } from "../favicon/google-favicon"

const chromeFavicon = new ChromeFaviconProvider()
const googleFavicon = new GoogleFaviconProvider()

export class ChromeFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    if (chromeFavicon.isAvailable()) {
      return chromeFavicon.getUrl(pageUrl)
    }
    return googleFavicon.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }

  getFallbackUrl(pageUrl: string): string {
    return googleFavicon.getUrl(pageUrl)
  }
}
