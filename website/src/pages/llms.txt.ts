import type { APIRoute } from "astro"
import { getCollection } from "astro:content"
import { PAGES } from "../lib/pages"
import { SITE } from "../lib/site"

/** Docs sections in sidebar order; the docs home sorts first. */
const DOCS_SECTIONS = ["docs/start/", "docs/daemon/", "docs/guides/"]

function link(name: string, path: string, summary: string): string {
  const url = new URL(path, SITE.url).href
  return `- [${name}](${url})${summary ? `: ${summary}` : ""}`
}

export const GET: APIRoute = async () => {
  const section = (id: string) =>
    DOCS_SECTIONS.findIndex((prefix) => `${id}/`.startsWith(prefix))
  const docs = (await getCollection("docs", (entry) => !entry.data.draft)).sort(
    (a, b) =>
      section(a.id) - section(b.id) ||
      (a.data.sidebar.order ?? Infinity) - (b.data.sidebar.order ?? Infinity) ||
      a.data.title.localeCompare(b.data.title)
  )

  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.tagline}`,
    "",
    "Bookmarks But Better is a free and open-source (MIT) browser extension for Chrome and Firefox that replaces the new-tab page with a private bookmarks dashboard. A Safari version is coming soon and can be built from source today. It has no account, analytics, tracking, ads, or bookmark-content collection. An optional local daemon keeps bookmarks as Markdown files in vaults you own.",
    "",
    "## Pages",
    "",
    ...[PAGES.home, PAGES.preview, PAGES.privacy].map((page) =>
      link(page.name, page.path, page.summary)
    ),
    "",
    "## Docs and guides",
    "",
    ...docs.map((entry) =>
      link(entry.data.title, `/${entry.id}/`, entry.data.description ?? "")
    ),
    "",
    "## Source",
    "",
    link("GitHub repository", SITE.repository, "source code and issue tracker"),
    "",
    "## Product constraints",
    "",
    "- Sources are never implicitly merged; operations affect only the active source.",
    "- The daemon binds to loopback addresses only.",
    "- Safari uses the daemon source because browser bookmarks are not available to extensions there.",
    "- The legacy Standalone source is retiring over one major version; migration is an explicit copy.",
    "",
  ]

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
