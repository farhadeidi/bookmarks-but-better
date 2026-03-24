import type { FaviconProvider } from "./types"

export class GoogleFaviconProvider implements FaviconProvider {
  getUrl(pageUrl: string): string {
    try {
      const domain = new URL(pageUrl).hostname
      return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`
    } catch {
      return ""
    }
  }

  isAvailable(): boolean {
    return true
  }
}
