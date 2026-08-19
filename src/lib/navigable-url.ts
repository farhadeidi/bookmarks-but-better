/**
 * Which URLs a client may follow on the user's behalf.
 *
 * A bookmark's URL is user data that ends up in `location` or in a
 * `tabs.create` call, so only http(s) is followed: a `javascript:` bookmark
 * would otherwise run in the extension page's own origin. Both surfaces that
 * open a bookmark from a search result — the in-page palette and the omnibox
 * listener in the service worker — share this one rule, so neither can be the
 * one that forgets it.
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
