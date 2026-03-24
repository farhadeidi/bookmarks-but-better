import type { FaviconProvider } from "./types"

export class ChromeFaviconProvider implements FaviconProvider {
  getUrl(pageUrl: string): string {
    // MV3 requires using _favicon API with the extension's own origin
    const extensionId = chrome.runtime.id
    return `chrome-extension://${extensionId}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=32`
  }

  isAvailable(): boolean {
    try {
      return (
        typeof chrome !== "undefined" &&
        typeof chrome.runtime !== "undefined" &&
        typeof chrome.runtime.id === "string"
      )
    } catch {
      return false
    }
  }
}
