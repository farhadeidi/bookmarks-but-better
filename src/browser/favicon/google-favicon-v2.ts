import type { FaviconProvider } from "./types"

export class GoogleFaviconV2Provider implements FaviconProvider {
  getUrl(pageUrl: string): string {
    try {
      const url = new URL(pageUrl).origin
      return `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(url)}&size=64`
    } catch {
      return ""
    }
  }

  isAvailable(): boolean {
    return true
  }
}
