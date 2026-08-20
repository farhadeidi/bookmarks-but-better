/**
 * The cache key for a bookmark's favicon.
 *
 * Favicons are a property of a *site*, not of a page: ten bookmarks under
 * `https://example.com/...` share one icon, and keying anything finer would
 * make the cache miss on every deep link. So the key is scheme + host + port,
 * and everything below it — path, query, fragment, credentials — is discarded
 * before the key is built.
 *
 * The three normalizations worth naming, because each one silently merges
 * entries that would otherwise be separate:
 *
 * - **Case and IDN.** `URL` lowercases the host and converts an
 *   internationalized name to its Punycode A-label, so `https://BÜCHER.example`
 *   and `https://xn--bcher-kva.example` produce one key. That is correct: they
 *   are the same origin, and the A-label is what any provider is asked for.
 * - **Port.** `URL` drops a port that is the scheme's default, so
 *   `https://example.com:443` and `https://example.com` share a key, while
 *   `http://localhost:3000` and `http://localhost:8080` do not. Two ports on
 *   one host really can serve different icons.
 * - **Trailing dot.** `example.com.` is the fully-qualified spelling of
 *   `example.com`; `URL` keeps the dot, so it is stripped here.
 *
 * Scheme is *not* normalized away. `http://` and `https://` are different
 * origins and a site may serve different icons on each, so they get separate
 * entries even though Google's `s2` provider would answer both from one
 * hostname.
 */

/**
 * The scheme + host + port key for a page URL, or `null` when the page can
 * have no favicon at all.
 *
 * `null` is returned for anything that is not HTTP(S) — an unparsable string, a
 * `file:` or `about:` or `javascript:` URL — because no favicon provider can
 * answer for those, and asking one would send a meaningless (and in the case of
 * a `file:` path, private) string to a third party.
 */
export function normalizeFaviconKey(pageUrl: string): string | null {
  let url: URL
  try {
    url = new URL(pageUrl)
  } catch {
    return null
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") return null

  const host = url.hostname.replace(/\.$/, "")
  if (!host) return null

  return url.port
    ? `${url.protocol}//${host}:${url.port}`
    : `${url.protocol}//${host}`
}
