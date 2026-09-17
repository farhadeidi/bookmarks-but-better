import type { APIRoute } from "astro"
import {
  DOCS_SECTIONS,
  docUrl,
  inSidebarOrder,
  OVERVIEW,
  publishedDocs,
  type Doc,
} from "../lib/llms"
import { PAGES } from "../lib/pages"
import { SITE } from "../lib/site"

/**
 * /llms.txt, in the structure llmstxt.org describes: an H1, a blockquote
 * summary, free-form prose and lists, then H2 sections that hold nothing but
 * links. The preamble carries the facts an agent would otherwise open three
 * pages to find, so a single fetch answers most questions about the product.
 * `## Optional` marks the links an agent can skip.
 *
 * /llms-full.txt has the same preamble followed by every page's text, for an
 * agent that would rather read once than crawl.
 */

function link(name: string, path: string, summary = ""): string {
  const url = new URL(path, SITE.url).href
  return `- [${name}](${url})${summary ? `: ${summary}` : ""}`
}

const docLink = (entry: Doc) =>
  `- [${entry.data.title}](${docUrl(entry)})${
    entry.data.description ? `: ${entry.data.description}` : ""
  }`

export const GET: APIRoute = async () => {
  const docs = await publishedDocs()
  const inSection = (prefix: string) =>
    docs.filter((entry) => `${entry.id}/`.startsWith(prefix))
  // The docs home is in no sidebar group; it belongs with the other pages.
  const docsHome = docs.find((entry) => entry.id === "docs")

  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.tagline}`,
    "",
    ...OVERVIEW,
    "## Pages",
    "",
    ...[PAGES.home, PAGES.preview, PAGES.privacy].map((page) =>
      link(page.name, page.path, page.summary)
    ),
    ...(docsHome ? [docLink(docsHome)] : []),
    "",
    ...DOCS_SECTIONS.flatMap(({ label, prefix }) => [
      `## ${label}`,
      "",
      ...inSection(prefix).sort(inSidebarOrder).map(docLink),
      "",
    ]),
    "## Optional",
    "",
    link("Full text", "/llms-full.txt", "every page on this site in one file"),
    link("GitHub repository", SITE.repository, "source code and issue tracker"),
    link("Releases", SITE.releases, "release notes and downloads"),
    link("MIT License", SITE.license, "the license the project ships under"),
    "",
  ]

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
