/**
 * Where a chosen result is opened, and the two limits on that.
 *
 * A bookmark's URL is user data that ends up in `location`, so only http(s)
 * is followed: a `javascript:` bookmark would otherwise run in the extension
 * page's own origin. A *background* tab is only expressible through the
 * extension tabs API, so a plain web client (the daemon web app) gets a
 * foreground tab rather than nothing at all.
 */

export function navigableUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null
  } catch {
    return null
  }
}

export function openResultUrl(
  url: string,
  options: { background: boolean }
): void {
  if (!options.background) {
    window.location.assign(url)
    return
  }

  const tabs = typeof chrome === "undefined" ? undefined : chrome.tabs
  if (tabs?.create) {
    void tabs.create({ url, active: false })
    return
  }

  window.open(url, "_blank", "noopener,noreferrer")
}
