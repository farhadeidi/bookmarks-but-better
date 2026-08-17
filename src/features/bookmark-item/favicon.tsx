import * as React from "react"
import { cn } from "@/lib/utils"
import { isGoogleDefaultGlobe } from "@/browser/favicon/detect-default-globe"

interface FaviconProps {
  url: string
  primarySrc: string
  fallbackSrc?: string
  title: string
  className?: string
  size?: number
}

export function Favicon({
  url,
  primarySrc,
  fallbackSrc,
  title,
  className,
  size = 20,
}: FaviconProps) {
  const [src, setSrc] = React.useState(primarySrc)
  const [failed, setFailed] = React.useState(false)

  React.useEffect(() => {
    setSrc(primarySrc)
    setFailed(false)
  }, [primarySrc])

  const handleError = React.useCallback(() => {
    if (!failed && fallbackSrc) {
      setSrc(fallbackSrc)
      setFailed(true)
    } else {
      setFailed(true)
    }
  }, [failed, fallbackSrc])

  const handleLoad = React.useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const img = e.currentTarget
      if (isGoogleDefaultGlobe(src, img.naturalWidth, img.naturalHeight)) {
        handleError()
      }
    },
    [src, handleError]
  )

  // An <img src=""> fires neither load nor error in Chromium, so an empty
  // primary URL can never reach handleError on its own: treat it as failed
  // from the first render. This is also the production edge for a malformed
  // page URL, where GoogleFaviconV2Provider.getUrl returns "".
  if (failed || !primarySrc) {
    // Final fallback: first letter of domain
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
        {letter}
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
