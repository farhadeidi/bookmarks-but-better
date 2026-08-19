import type { BookmarkNode } from "@/browser"

/**
 * Matching a typed query against one source's bookmarks.
 *
 * Deliberately free of React, DOM and adapter concerns: the in-page palette
 * runs this over the store's tree, and the omnibox runs the same function in
 * a service worker over whatever tree the Active Source hands it. The caller
 * passes the one tree it means — nothing here reaches for a source, so
 * sources can never be merged by searching.
 */

export type BookmarkSearchKind = "bookmark" | "folder"

export interface BookmarkSearchHit {
  id: string
  title: string
  /** Absent for folders. */
  url?: string
  kind: BookmarkSearchKind
  /**
   * Titles of the folders containing the hit, outermost first. The scope is a
   * whole source rather than whatever subtree a client happens to be showing,
   * so a hit has to be able to say where it lives.
   */
  folderPath: string[]
  /** Higher is a better match. Exposed so a caller can re-rank or explain. */
  score: number
}

export interface BookmarkSearchOptions {
  /** Keep only the best `limit` hits. Unset returns every match. */
  limit?: number
}

/**
 * The four ways a node can match, ranked. Every prefix match outranks every
 * substring match: a query is nearly always the start of the thing being
 * looked for, so "git" wanting GitHub above "Legit blog" matters more than
 * whether the match landed on a title or on a URL.
 */
const TITLE_PREFIX = 4
const URL_PREFIX = 3
const TITLE_SUBSTRING = 2
const URL_SUBSTRING = 1

/**
 * The parts of a URL a user could plausibly be typing the start of. Nobody
 * searches for "https://", so without this every URL prefix match would
 * degrade into a substring match and rank below unrelated title hits.
 */
function urlPrefixes(url: string): string[] {
  const withoutScheme = url.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
  return [url, withoutScheme, withoutScheme.replace(/^www\./, "")]
}

function scoreNode(node: BookmarkNode, needle: string): number {
  const title = node.title.toLowerCase()
  if (title.startsWith(needle)) return TITLE_PREFIX

  const url = node.url?.toLowerCase()
  if (url && urlPrefixes(url).some((candidate) => candidate.startsWith(needle)))
    return URL_PREFIX
  if (title.includes(needle)) return TITLE_SUBSTRING
  if (url?.includes(needle)) return URL_SUBSTRING

  return 0
}

function collect(
  nodes: readonly BookmarkNode[],
  folderPath: string[],
  needle: string,
  hits: BookmarkSearchHit[]
): void {
  for (const node of nodes) {
    const kind: BookmarkSearchKind = node.url == null ? "folder" : "bookmark"
    const score = scoreNode(node, needle)

    if (score > 0) {
      hits.push({
        id: node.id,
        title: node.title,
        url: node.url,
        kind,
        folderPath,
        score,
      })
    }

    if (node.children) {
      // A browser's tree is rooted in a synthetic folder with no title, and
      // naming it in a path would print a separator with nothing before it.
      collect(
        node.children,
        node.title ? [...folderPath, node.title] : folderPath,
        needle,
        hits
      )
    }
  }
}

/**
 * Every bookmark and folder in `roots` whose title or URL matches `query`,
 * best first.
 *
 * The query is one needle, not a set of terms: at the collection sizes this
 * product is built for the extra recall buys nothing, and a single needle is
 * a rule a user can predict from one result list.
 */
export function searchBookmarks(
  roots: readonly BookmarkNode[],
  query: string,
  options: BookmarkSearchOptions = {}
): BookmarkSearchHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === "") return []

  const hits: BookmarkSearchHit[] = []
  collect(roots, [], needle, hits)

  // Sorting is stable in every engine these builds target, so equally scored
  // hits keep tree order: refining a query never reshuffles the rows the user
  // is already reading past.
  hits.sort((a, b) => b.score - a.score)

  return options.limit === undefined ? hits : hits.slice(0, options.limit)
}
