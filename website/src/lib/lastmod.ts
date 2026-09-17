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

const WEBSITE = fileURLToPath(new URL("../../", import.meta.url))

/** Where a built URL's source could live, in the order Astro resolves it. */
function sourcesFor(pathname: string): string[] {
  const slug = pathname.replace(/^\/+|\/+$/g, "")
  if (slug === "") return ["src/pages/index.astro"]
  // Docs pages are content entries under src/content/docs/, which already
  // holds the extra docs/ segment that puts every page below /docs/.
  const bases =
    slug === "docs" || slug.startsWith("docs/")
      ? [`src/content/docs/${slug}`]
      : [`src/pages/${slug}`]
  return bases.flatMap((base) => [
    `${base}.astro`,
    `${base}.md`,
    `${base}.mdx`,
    `${base}/index.md`,
    `${base}/index.mdx`,
  ])
}

const cache = new Map<string, string | undefined>()

function commitDate(file: string): string | undefined {
  const cached = cache.get(file)
  if (cached !== undefined || cache.has(file)) return cached
  let date: string | undefined
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", file], {
      cwd: WEBSITE,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
    date = out || undefined
  } catch {
    date = undefined
  }
  cache.set(file, date)
  return date
}

export function lastModified(pathname: string): string | undefined {
  for (const source of sourcesFor(pathname)) {
    if (existsSync(new URL(source, new URL("../../", import.meta.url)))) {
      return commitDate(source)
    }
  }
  return undefined
}
