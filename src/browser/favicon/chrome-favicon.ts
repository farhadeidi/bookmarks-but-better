import type { FaviconProvider } from "./types"

export class ChromeFaviconProvider implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return `chrome://favicon/size/16@2x/${pageUrl}`
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
