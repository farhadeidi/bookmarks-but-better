import * as React from "react"
import { cn } from "@/lib/utils"

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

  if (failed && (!fallbackSrc || src === fallbackSrc)) {
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
      loading="lazy"
    />
  )
}
