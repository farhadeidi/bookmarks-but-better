/**
 * Resolving one bookmark's favicon: cache, then the platform's providers in
 * order, then the letter placeholder.
 *
 * The provider order itself belongs to the source's `FaviconProvider` — this
 * module never names a browser. What it adds around that order is the three
 * things a per-card `<img src>` could not do:
 *
 * 1. **Bytes.** A provider response whose bytes this build is allowed to read
 *    is stored locally, and every later render of that site is fully local.
 * 2. **One lookup per site.** Ten bookmarks on one origin mounting together
 *    share a single resolution, not ten.
 * 3. **A verdict.** "Nobody has an icon for this site" is remembered, so the
 *    failed request is not repeated on every render.
 *
 * Whether a provider's bytes can be read is a Platform Capability discovered at
 * runtime, not a browser name. A `fetch` that *rejects* means this build has no
 * CORS grant for that origin — true for Google from the daemon web app, false
 * for Google from the extensions, which declare it in `host_permissions`. The
 * origin is remembered as opaque so the remaining bookmarks do not each pay a
 * doomed request, and its URL is handed to the `<img>` instead, which loads it
 * fine: the response allows cross-origin *embedding*, just not *reading*.
 */

import type { FaviconProvider } from "../types"
import { FAVICON_MAX_BYTES, FaviconCache, type FaviconRecord } from "./cache"
import {
  isGoogleDefaultGlobe,
  isGoogleFaviconUrl,
} from "./detect-default-globe"
import { normalizeFaviconKey } from "./key"

export interface FaviconResolution {
  /**
   * Ordered image sources for the `<img>`, most-preferred first.
   *
   * A single `blob:` URL when the cache answered, in which case nothing
   * external is contacted at all. Otherwise the provider URLs still worth
   * trying in the browser, in provider order. Empty means the letter
   * placeholder: either no provider can answer for this page, or all of them
   * have already been asked and missed.
   */
  sources: string[]
}

const NO_SOURCES: FaviconResolution = { sources: [] }

interface ImageSize {
  width: number
  height: number
}

export interface FaviconResolverOptions {
  cache?: FaviconCache
  fetchImpl?: typeof fetch
  /** Decodes an icon's intrinsic size, or `null` when it cannot be decoded. */
  decode?: (bytes: ArrayBuffer, mime: string) => Promise<ImageSize | null>
  /** The document's own origin, used to spot a provider we serve ourselves. */
  pageOrigin?: string
}

/**
 * Decodes intrinsic dimensions through `createImageBitmap`, the one decoder
 * available without a DOM. A `null` answer is not a failure — it means "this
 * build cannot measure the icon", and the caller degrades to letting the
 * `<img>` measure it after load, exactly as the UI did before this cache.
 */
async function decodeImageSize(
  bytes: ArrayBuffer,
  mime: string
): Promise<ImageSize | null> {
  if (typeof createImageBitmap !== "function") return null
  try {
    const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }))
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return null
  }
}

function currentOrigin(): string {
  return typeof location === "undefined" ? "" : originOf(location.href)
}

/**
 * The origin of a URL, spelled out rather than taken from `URL.origin`.
 *
 * `URL.origin` is `"null"` for any scheme the URL parser does not know as
 * special, which includes `chrome-extension:` outside a browser that registered
 * it — so the one provider served on the extension's own origin would compare
 * equal to every other unknown-scheme URL. Scheme plus host is unambiguous for
 * every scheme this ever sees.
 */
function originOf(url: string): string {
  const parsed = new URL(url)
  return `${parsed.protocol}//${parsed.host}`
}

function bytesEqual(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false
  const left = new Uint8Array(a)
  const right = new Uint8Array(b)
  for (let i = 0; i < left.length; i += 1) {
    if (left[i] !== right[i]) return false
  }
  return true
}

/**
 * What one provider response turned out to be.
 *
 * `placeholder` and `none` both mean "this provider has no icon for this
 * site", and the walk moves on. `remote` means the bytes could not be read or
 * judged here, so the URL is passed to the `<img>` rather than cached.
 */
type Verdict = "icon" | "placeholder" | "none" | "remote"

export class FaviconResolver {
  private readonly cache: FaviconCache
  private readonly fetchImpl: typeof fetch
  private readonly decode: (
    bytes: ArrayBuffer,
    mime: string
  ) => Promise<ImageSize | null>
  private readonly pageOrigin: string

  /** One in-flight resolution per site key — the deduplication itself. */
  private readonly inFlight = new Map<string, Promise<FaviconResolution>>()

  /** Origins this build turned out not to be allowed to read bytes from. */
  private readonly opaqueOrigins = new Set<string>()

  /** The placeholder sample per probe URL, fetched at most once per session. */
  private readonly probes = new Map<string, Promise<ArrayBuffer | null>>()

  constructor(options: FaviconResolverOptions = {}) {
    this.cache = options.cache ?? new FaviconCache()
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args))
    this.decode = options.decode ?? decodeImageSize
    this.pageOrigin = options.pageOrigin ?? currentOrigin()
  }

  /**
   * The sources to render for a page.
   *
   * Never rejects. Every failure below — a closed IndexedDB, an offline
   * network, a provider that throws — degrades to fewer sources, and no
   * sources at all is the letter placeholder, which is always a valid answer.
   */
  resolve(
    pageUrl: string,
    provider: FaviconProvider
  ): Promise<FaviconResolution> {
    const key = normalizeFaviconKey(pageUrl)
    if (!key) return Promise.resolve(NO_SOURCES)

    const existing = this.inFlight.get(key)
    if (existing) return existing

    const pending = this.run(key, pageUrl, provider)
      .catch(() => NO_SOURCES)
      .finally(() => {
        this.inFlight.delete(key)
      })
    this.inFlight.set(key, pending)
    return pending
  }

  /**
   * Records that every source for a page failed in the browser.
   *
   * This is the other half of the globe check: a Google response whose bytes
   * this build could not read is judged by the `<img>` after it loads, and that
   * judgement has to come back here or the same futile request is made again on
   * the next render. It writes a *negative* entry, never the globe's bytes.
   */
  async reportMiss(pageUrl: string): Promise<void> {
    const key = normalizeFaviconKey(pageUrl)
    if (!key) return
    try {
      await this.cache.putMiss(key)
    } catch {
      // A cache that will not write is a lost optimization, not a failure.
    }
  }

  private async run(
    key: string,
    pageUrl: string,
    provider: FaviconProvider
  ): Promise<FaviconResolution> {
    const cached = await this.read(key)
    if (cached) {
      return { sources: cached.bytes ? [this.cache.materialize(cached)] : [] }
    }

    const remote: string[] = []
    for (const url of candidateUrls(pageUrl, provider)) {
      const outcome = await this.attempt(key, url, provider)
      if (outcome.verdict === "icon") return { sources: [outcome.src] }
      if (outcome.verdict === "remote") remote.push(url)
    }

    if (remote.length > 0) return { sources: remote }

    // Every provider was asked and answered definitively: nothing exists.
    await this.reportMiss(pageUrl)
    return NO_SOURCES
  }

  private async read(key: string): Promise<FaviconRecord | null> {
    try {
      return await this.cache.get(key)
    } catch {
      return null
    }
  }

  private async attempt(
    key: string,
    url: string,
    provider: FaviconProvider
  ): Promise<{ verdict: Verdict; src: string }> {
    let origin: string
    try {
      origin = originOf(url)
    } catch {
      return { verdict: "none", src: "" }
    }

    /**
     * A provider whose miss is only recognizable from its bytes must never be
     * handed to the `<img>` unread: its placeholder loads perfectly well and
     * would sit there looking like the site's icon, with no error to fall
     * forward from. So for a guarded candidate, anything short of a verified
     * icon is "none" — skip it and let the next provider answer, which is the
     * order the UI had before this cache existed.
     */
    const guarded =
      Boolean(provider.getPlaceholderProbeUrl?.()) && origin === this.pageOrigin
    const unreadable: Verdict = guarded ? "none" : "remote"

    if (this.opaqueOrigins.has(origin)) return { verdict: unreadable, src: "" }

    let response: Response
    try {
      response = await this.fetchImpl(url)
    } catch {
      // Not an answer about this site: this build simply may not read that
      // origin. Remember it, and let the `<img>` do what it always could.
      this.opaqueOrigins.add(origin)
      return { verdict: unreadable, src: "" }
    }

    if (!response.ok) return { verdict: "none", src: "" }

    let bytes: ArrayBuffer
    try {
      bytes = await response.arrayBuffer()
    } catch {
      return { verdict: unreadable, src: "" }
    }
    if (bytes.byteLength === 0 || bytes.byteLength > FAVICON_MAX_BYTES) {
      return { verdict: "none", src: "" }
    }

    const mime = response.headers.get("content-type") ?? "image/png"
    const verdict = await this.classify(url, bytes, mime, provider, unreadable)
    if (verdict !== "icon") return { verdict, src: "" }

    return {
      verdict: "icon",
      src: this.cache.materialize(await this.store(key, bytes, mime)),
    }
  }

  /**
   * Stores an icon, and produces a record either way. A cache that will not
   * write costs the *next* load its speed and its privacy; it must not cost
   * this one its icon, which is already in hand.
   */
  private async store(
    key: string,
    bytes: ArrayBuffer,
    mime: string
  ): Promise<FaviconRecord> {
    try {
      return await this.cache.putIcon(key, bytes, mime)
    } catch {
      return { key, storedAt: Date.now(), bytes, mime }
    }
  }

  /**
   * Whether these bytes are a real icon or a provider's "I have nothing" image.
   *
   * Both providers that can miss have a recognizable miss, and caching either
   * one would pin that site to a generic globe until the entry expired — the
   * single worst thing a byte cache can do here.
   *
   * Google's is recognized by shape, through the same `isGoogleDefaultGlobe`
   * the UI has always used, now applied to the decoded bytes *before* they are
   * stored instead of to a rendered `<img>` afterwards.
   *
   * A provider we serve ourselves — Chrome's `_favicon`, same-origin to this
   * page — is recognized by sampling it: `getPlaceholderProbeUrl` asks it about
   * a site it cannot possibly know, and any response equal to that sample is a
   * miss. Sampling rather than hard-coding means the check keeps working when
   * the browser changes its placeholder art.
   *
   * "Unverifiable" is deliberately *not* treated as "icon". If the sample could
   * not be taken, or the bytes could not be decoded, the response is passed to
   * the `<img>` instead of stored, which is exactly the behavior that existed
   * before this cache — never a permanently cached maybe-placeholder.
   */
  private async classify(
    url: string,
    bytes: ArrayBuffer,
    mime: string,
    provider: FaviconProvider,
    unreadable: Verdict
  ): Promise<Verdict> {
    const probeUrl = provider.getPlaceholderProbeUrl?.()
    if (probeUrl && originOf(url) === this.pageOrigin) {
      const sample = await this.probe(probeUrl)
      if (!sample) return unreadable
      return bytesEqual(sample, bytes) ? "placeholder" : "icon"
    }

    if (!isGoogleFaviconUrl(url)) return "icon"

    const size = await this.decode(bytes, mime)
    if (!size) return unreadable
    return isGoogleDefaultGlobe(url, size.width, size.height)
      ? "placeholder"
      : "icon"
  }

  private probe(probeUrl: string): Promise<ArrayBuffer | null> {
    const existing = this.probes.get(probeUrl)
    if (existing) return existing

    const pending = this.fetchImpl(probeUrl)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .catch(() => null)
    this.probes.set(probeUrl, pending)
    return pending
  }
}

/** The provider's ordered URLs, without empties or a repeated entry. */
function candidateUrls(pageUrl: string, provider: FaviconProvider): string[] {
  const urls: string[] = []
  for (const url of [
    provider.getUrl(pageUrl),
    provider.getFallbackUrl?.(pageUrl),
  ]) {
    if (url && !urls.includes(url)) urls.push(url)
  }
  return urls
}

/**
 * The resolver the UI uses. One per document, because the deduplication map,
 * the opaque-origin set and the placeholder sample are all page-lifetime facts
 * that would be pointless to rebuild per component.
 */
export const faviconResolver = new FaviconResolver()
