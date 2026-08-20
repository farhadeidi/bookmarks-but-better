import type { FaviconProvider } from "./types"

/**
 * A host Chrome cannot have an icon for, used to sample the `_favicon`
 * placeholder. `.invalid` is reserved by RFC 2606 and can never be registered,
 * and the request itself never leaves the machine — `_favicon` is served by the
 * extension's own origin out of the browser's local icon database.
 */
const PLACEHOLDER_PROBE_PAGE = "https://favicon-probe.invalid/"

export class ChromeFaviconProvider implements FaviconProvider {
  getUrl(pageUrl: string): string {
    // MV3 requires using _favicon API with the extension's own origin
    const extensionId = chrome.runtime.id
    return `chrome-extension://${extensionId}/_favicon/?pageUrl=${encodeURIComponent(pageUrl)}&size=64`
  }

  getPlaceholderProbeUrl(): string {
    if (!this.isAvailable()) return ""
    return this.getUrl(PLACEHOLDER_PROBE_PAGE)
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
