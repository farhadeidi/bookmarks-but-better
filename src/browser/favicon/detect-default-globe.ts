const GLOBE_NATURAL_SIZE = 16

const GOOGLE_FAVICON_HOSTS = [
  "https://t0.gstatic.com/faviconV2",
  "https://t1.gstatic.com/faviconV2",
  "https://t2.gstatic.com/faviconV2",
  "https://t3.gstatic.com/faviconV2",
  "https://www.google.com/s2/favicons",
]

function isGoogleFaviconUrl(url: string): boolean {
  return GOOGLE_FAVICON_HOSTS.some((prefix) => url.startsWith(prefix))
}

export function isGoogleDefaultGlobe(
  url: string,
  naturalWidth: number,
  naturalHeight: number
): boolean {
  if (!url || !isGoogleFaviconUrl(url)) return false
  return (
    naturalWidth === GLOBE_NATURAL_SIZE && naturalHeight === GLOBE_NATURAL_SIZE
  )
}
