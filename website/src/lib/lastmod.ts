import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * `lastmod` for the sitemap, taken from git rather than from the build clock.
 * Google only uses the value while it stays consistently accurate, so a date
 * that moves whenever the site is rebuilt is worse than no date at all.
 *
 * This needs the full history. A shallow clone reports the same commit date
 * for every file, which is exactly the inaccuracy above, so .github/workflows/
 * website.yml checks out with `fetch-depth: 0`. Where history is missing or
 * git is absent, every page simply has no `lastmod`.
 */

const WEBSITE = new URL("../../", import.meta.url)

/** Where a built URL's source could live, in the order Astro resolves it. */
function sourcesFor(pathname: string): string[] {
  const slug = pathname.replace(/^\/+|\/+$/g, "")
  if (slug === "") return ["src/pages/index.astro"]
  // Docs pages are content entries under src/content/docs/, which already
  // holds the extra docs/ segment that puts every page below /docs/.
  const base =
    slug === "docs" || slug.startsWith("docs/")
      ? `src/content/docs/${slug}`
      : `src/pages/${slug}`
  return [
    `${base}.astro`,
    `${base}.md`,
    `${base}.mdx`,
    `${base}/index.md`,
    `${base}/index.mdx`,
  ]
}

const cache = new Map<string, string | undefined>()

function commitDate(file: string): string | undefined {
  if (cache.has(file)) return cache.get(file)
  let date: string | undefined
  try {
    date =
      execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
        cwd: fileURLToPath(WEBSITE),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
  } catch {
    date = undefined
  }
  cache.set(file, date)
  return date
}

export function lastModified(pathname: string): string | undefined {
  const source = sourcesFor(pathname).find((candidate) =>
    existsSync(new URL(candidate, WEBSITE))
  )
  return source ? commitDate(source) : undefined
}
