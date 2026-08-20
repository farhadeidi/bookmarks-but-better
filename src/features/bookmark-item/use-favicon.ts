/**
 * The React side of favicon resolution.
 *
 * Resolution became asynchronous when it gained a cache, so a row can no longer
 * be handed a finished URL by its parent. It asks here instead, and the
 * resolver deduplicates: a folder card with ten bookmarks on one origin
 * mounting at once produces one lookup, not ten.
 */

import * as React from "react"
import { faviconResolver } from "@/browser/favicon/resolve"
import { normalizeFaviconKey } from "@/browser/favicon/key"
import { useBookmarkStore } from "@/stores/bookmark-store"

export interface FaviconSources {
  /** Ordered sources to try, most-preferred first. Empty means the letter. */
  sources: string[]
  /** True while the first answer for this page is still being worked out. */
  pending: boolean
}

const NOTHING: FaviconSources = { sources: [], pending: false }

export function useFaviconSources(pageUrl: string): FaviconSources {
  const provider = useBookmarkStore((s) => s.adapter?.favicon)
  const [resolved, setResolved] = React.useState<{
    pageUrl: string
    sources: string[]
  } | null>(null)

  // A page no provider could ever answer for — not HTTP(S), or not a URL at
  // all — is settled synchronously, so a malformed bookmark shows its letter
  // on the first render instead of flickering through a pending frame.
  const resolvable = normalizeFaviconKey(pageUrl) !== null

  React.useEffect(() => {
    if (!resolvable || !provider) return
    let cancelled = false
    faviconResolver.resolve(pageUrl, provider).then((resolution) => {
      if (!cancelled) setResolved({ pageUrl, sources: resolution.sources })
    })
    return () => {
      cancelled = true
    }
  }, [pageUrl, provider, resolvable])

  if (!resolvable || !provider) return NOTHING
  // Anything resolved for a *previous* URL is not an answer for this one.
  if (resolved?.pageUrl !== pageUrl) return { sources: [], pending: true }
  return { sources: resolved.sources, pending: false }
}
