import type { FaviconProvider } from "../types"
import { GoogleFaviconV2Provider } from "../favicon/google-favicon-v2"

const googleV2 = new GoogleFaviconV2Provider()

export class FirefoxFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return googleV2.getUrl(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }
}
