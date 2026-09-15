import type { CollectionEntry } from "astro:content"

type Guide = CollectionEntry<"guides">

/** Newest first. */
export function byNewest(a: Guide, b: Guide): number {
  return b.data.publishedAt.valueOf() - a.data.publishedAt.valueOf()
}

const DATE_FORMAT = new Intl.DateTimeFormat("en", {
  dateStyle: "long",
  timeZone: "UTC",
})

export function formatDate(date: Date): string {
  return DATE_FORMAT.format(date)
}
