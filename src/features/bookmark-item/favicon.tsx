import * as React from "react"
import { cn } from "@/lib/utils"
import { isGoogleDefaultGlobe } from "@/browser/favicon/detect-default-globe"
import { faviconResolver } from "@/browser/favicon/resolve"
import { useFaviconSources } from "./use-favicon"

interface FaviconProps {
  url: string
  title: string
  className?: string
  size?: number
}

/**
 * A bookmark's icon: whatever the resolver offers, then the letter placeholder.
 *
 * The component used to be handed a primary and a fallback URL by its parent
 * and pick between them. It now asks the resolver for an ordered list, because
 * the first entry may be a `blob:` URL out of the local cache and there may be
 * no remote entry at all. Walking a list is the same logic as before, one
 * `<img>` at a time, generalized from two candidates to n.
 *
 * The globe check stays here as well as in the resolver, and has to. The
 * resolver catches Google's generic globe only when it was allowed to read the
 * bytes; where it was not — the daemon web app, which has no host permission
 * for gstatic — the response reaches this `<img>` unread, and its rendered size
 * is the only place the globe is visible. Treating it as an error is what makes
 * the letter win for sites Google has nothing for.
 */
export function Favicon({ url, title, className, size = 20 }: FaviconProps) {
  const { sources, pending } = useFaviconSources(url)
  // How far into *this* list of sources the walk has got. Carrying the list
  // itself in the state is what makes a new list start over at zero without a
  // reset effect, and without a frame where an old index points past the end.
  const [attempt, setAttempt] = React.useState({ sources, index: 0 })
  const active = attempt.sources === sources ? attempt : { sources, index: 0 }

  const src = active.sources[active.index] ?? ""
  const exhausted = sources.length > 0 && active.index >= sources.length

  // Nothing left to try. Tell the resolver, so the next render shows the
  // letter straight from the cache instead of repeating a request that has
  // already failed — and so a `blob:` URL that will not decode drops its
  // record rather than failing forever.
  React.useEffect(() => {
    if (exhausted) void faviconResolver.reportMiss(url)
  }, [exhausted, url])

  const handleError = () => {
    setAttempt({ sources: active.sources, index: active.index + 1 })
  }

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    if (isGoogleDefaultGlobe(src, img.naturalWidth, img.naturalHeight)) {
      handleError()
    }
  }

  // An `<img src="">` fires neither load nor error in Chromium, so an empty
  // source can never reach handleError on its own: it has to start at the
  // placeholder. That covers three cases at once — a page no provider can
  // answer for, a cached "nobody has an icon for this site", and every source
  // having been tried and failed. `pending` renders the same box without a
  // letter, so the first frame does not flash a letter that is about to be
  // replaced, and nothing moves when the icon arrives.
  if (pending || !src) {
    let letter = "?"
    try {
      letter = new URL(url).hostname.charAt(0).toUpperCase()
    } catch {
      // keep "?"
    }

    return (
      <span
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-md bg-muted text-xs font-medium text-muted-foreground",
          className
        )}
        style={{ width: size, height: size, minWidth: size, minHeight: size }}
        aria-label={title}
      >
        {pending ? "" : letter}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      draggable="false"
      className={cn("shrink-0 rounded-sm object-contain", className)}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
      onError={handleError}
      onLoad={handleLoad}
      loading="lazy"
    />
  )
}
