/**
 * The local favicon cache: image *bytes*, in IndexedDB, keyed by site.
 *
 * Caching the bytes rather than a provider URL is the whole point. A cached
 * URL still costs a request to a third party on every render, which is exactly
 * what makes favicons the one place this product routinely tells someone else
 * which sites a user has bookmarked. Bytes in IndexedDB render entirely
 * locally, work offline, and survive a reload.
 *
 * Negative entries (a record with no bytes) matter just as much. A site that
 * has no icon anywhere would otherwise pay one or two failed external requests
 * on every single render, forever. Remembering "nobody could answer for this
 * site" turns that into one lookup a day and shows the letter placeholder
 * instantly.
 *
 * Storage is IndexedDB, the same store family the profile preferences and the
 * standalone source already use, in its own database so that clearing or
 * corrupting icons can never touch bookmarks or preferences. Bytes are held as
 * `ArrayBuffer` rather than `Blob`: an `ArrayBuffer` is structured-cloneable
 * everywhere, including in the test IndexedDB, and the `Blob` is rebuilt at the
 * moment an object URL is needed.
 */

/**
 * How long a cached icon is served without asking anyone again.
 *
 * Thirty days. Favicons change on the order of a rebrand, and the cost of
 * staleness is a month of a slightly old icon; the cost of a short TTL is
 * paid in third-party requests by every user on every expiry. A daily user
 * ends up disclosing an origin about twelve times a year instead of hundreds.
 */
export const FAVICON_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * How long "no provider could answer for this site" is believed.
 *
 * One day, far shorter than a hit. A negative entry is a claim about the
 * *world* — that the site has no icon, or that Google only offered its generic
 * globe — and that claim goes stale the moment the site adds a favicon. A day
 * is short enough that a newly added icon appears the next time the dashboard
 * is opened tomorrow, and long enough to stop the repeated failed request.
 */
export const FAVICON_MISS_TTL_MS = 24 * 60 * 60 * 1000

/**
 * The entry ceiling, and the level a trim brings the cache back down to.
 *
 * A thousand entries is roughly a thousand distinct sites — more than the
 * distinct-origin count of even a very large bookmark collection — and at the
 * few kilobytes a favicon weighs it lands around 2-5 MB, comfortably inside any
 * IndexedDB quota. Trimming to 900 rather than to the ceiling means a full
 * cache runs one eviction pass per hundred inserts instead of one per insert.
 */
export const FAVICON_MAX_ENTRIES = 1000
export const FAVICON_TRIM_TO = 900

/**
 * The largest single icon that is worth storing. Anything past a quarter of a
 * megabyte is not a favicon — it is a provider handing back a full-size image —
 * and one such response should not be allowed to dominate the cache.
 */
export const FAVICON_MAX_BYTES = 256 * 1024

const DB_NAME = "bookmarks-but-better-favicons"
const DB_VERSION = 1
const STORE_NAME = "icons"
const STORED_AT_INDEX = "storedAt"

export interface FaviconRecord {
  /** The normalized site key, and the store's primary key. */
  key: string
  storedAt: number
  /** Absent on a negative entry: nobody could answer for this site. */
  bytes?: ArrayBuffer
  mime?: string
}

/**
 * Creating and revoking object URLs, injectable because neither jsdom nor Node
 * implements them and the tests need to observe that every URL handed out is
 * eventually revoked.
 */
export interface ObjectUrlFactory {
  create(blob: Blob): string
  revoke(url: string): void
}

const defaultObjectUrls: ObjectUrlFactory = {
  create: (blob) => URL.createObjectURL(blob),
  revoke: (url) => URL.revokeObjectURL(url),
}

export interface FaviconCacheOptions {
  now?: () => number
  objectUrls?: ObjectUrlFactory
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" })
        // Eviction walks this index oldest-first. It is the only ordering the
        // cache needs, because entries expire in the same order they evict.
        store.createIndex(STORED_AT_INDEX, "storedAt")
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export class FaviconCache {
  private db: IDBDatabase | null = null
  private readonly now: () => number
  private readonly objectUrls: ObjectUrlFactory

  /**
   * The live object URL per site key.
   *
   * One URL per *site*, created lazily and reused by every bookmark on that
   * site, for as long as its record stands. The alternative — an object URL per
   * `<img>` — leaks one blob per bookmark per render, which would cost more
   * memory than the cache saves in requests. A URL is revoked as soon as its
   * record stops being the truth: replaced, evicted, or invalidated.
   */
  private readonly liveUrls = new Map<string, string>()

  constructor(options: FaviconCacheOptions = {}) {
    this.now = options.now ?? Date.now
    this.objectUrls = options.objectUrls ?? defaultObjectUrls
  }

  private async getDB(): Promise<IDBDatabase> {
    if (!this.db) {
      this.db = await openDB()
    }
    return this.db
  }

  /**
   * The fresh record for a site, or `null` when there is none.
   *
   * An expired record reads as `null` and is left in place rather than deleted:
   * a stale read is always followed by a write for the same key, so deleting
   * here would only add a transaction. Whatever is never re-resolved is
   * eventually evicted by age.
   */
  async get(key: string): Promise<FaviconRecord | null> {
    const db = await this.getDB()
    const record = await new Promise<FaviconRecord | undefined>(
      (resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly")
        const request = tx.objectStore(STORE_NAME).get(key)
        request.onsuccess = () =>
          resolve(request.result as FaviconRecord | undefined)
        request.onerror = () => reject(request.error)
      }
    )

    if (!record) return null
    const ttl = record.bytes ? FAVICON_TTL_MS : FAVICON_MISS_TTL_MS
    if (this.now() - record.storedAt >= ttl) return null
    return record
  }

  /** Stores icon bytes for a site, replacing whatever was there. */
  async putIcon(
    key: string,
    bytes: ArrayBuffer,
    mime: string
  ): Promise<FaviconRecord> {
    const record: FaviconRecord = { key, storedAt: this.now(), bytes, mime }
    await this.write(record)
    return record
  }

  /** Records that no provider could answer for this site. */
  async putMiss(key: string): Promise<void> {
    await this.write({ key, storedAt: this.now() })
  }

  private async write(record: FaviconRecord): Promise<void> {
    const db = await this.getDB()
    // The record being replaced may already be rendering somewhere; its URL is
    // no longer the truth, so it goes with the old bytes.
    this.releaseUrl(record.key)

    const evicted: string[] = []
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite")
      const store = tx.objectStore(STORE_NAME)
      store.put(record)

      const countRequest = store.count()
      countRequest.onsuccess = () => {
        let remaining = countRequest.result - FAVICON_TRIM_TO
        if (remaining <= 0 || countRequest.result <= FAVICON_MAX_ENTRIES) return

        const cursorRequest = store.index(STORED_AT_INDEX).openCursor()
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result
          if (!cursor || remaining <= 0) return
          evicted.push(cursor.primaryKey as string)
          cursor.delete()
          remaining -= 1
          cursor.continue()
        }
      }

      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })

    for (const key of evicted) this.releaseUrl(key)
  }

  /**
   * A URL the UI can put in an `<img>`, for a record that has bytes.
   *
   * Returns `""` for a negative record, which is the signal the letter
   * placeholder is built from.
   */
  materialize(record: FaviconRecord): string {
    if (!record.bytes) return ""
    const existing = this.liveUrls.get(record.key)
    if (existing) return existing

    const url = this.objectUrls.create(
      new Blob([record.bytes], { type: record.mime || "image/png" })
    )
    this.liveUrls.set(record.key, url)
    return url
  }

  /** Drops a site's object URL, if one is live. */
  releaseUrl(key: string): void {
    const url = this.liveUrls.get(key)
    if (!url) return
    this.liveUrls.delete(key)
    this.objectUrls.revoke(url)
  }
}
