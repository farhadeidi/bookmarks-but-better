import type { FaviconProvider } from "../types"

function hashString(input: string): number {
  let hash = 0
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i)
    hash |= 0
  }
  return Math.abs(hash)
}

function hostnameOf(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname
  } catch {
    return pageUrl
  }
}

/**
 * Generates a deterministic local favicon as a data: URI — no network
 * request is ever made, which is required in daemon mode since fetching
 * favicons from a third-party service would leak the user's bookmarked
 * hosts off the loopback-only vault.
 */
export function localFaviconDataUri(pageUrl: string): string {
  const hostname = hostnameOf(pageUrl)
  const letter = (hostname.charAt(0) || "?").toUpperCase()
  const hue = hashString(hostname) % 360
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" rx="12" fill="hsl(${hue}, 45%, 55%)"/>` +
    `<text x="32" y="43" font-family="sans-serif" font-size="30" text-anchor="middle" fill="white">${letter}</text>` +
    `</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

export class DaemonFaviconAdapter implements FaviconProvider {
  getUrl(pageUrl: string): string {
    return localFaviconDataUri(pageUrl)
  }

  isAvailable(): boolean {
    return true
  }
}
