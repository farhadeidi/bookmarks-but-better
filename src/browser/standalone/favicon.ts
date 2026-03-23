import type { FaviconProvider } from "../types"
import { GoogleFaviconProvider } from "../favicon/google-favicon"

const googleFavicon = new GoogleFaviconProvider()

export class StandaloneFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return googleFavicon.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }
}
