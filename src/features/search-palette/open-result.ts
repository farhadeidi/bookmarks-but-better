/**
 * Where a chosen result is opened, and the one limit on that.
 *
 * A *background* tab is only expressible through the extension tabs API, so a
 * plain web client (the daemon web app) gets a foreground tab rather than
 * nothing at all. Which URLs may be followed at all is `navigableUrl`'s rule,
 * shared with the omnibox.
 */

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
