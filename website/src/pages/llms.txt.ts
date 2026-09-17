import type { APIRoute } from "astro"
import {
  DOCS_SECTIONS,
  docUrl,
  inSection,
  OVERVIEW,
  publishedDocs,
  type Doc,
} from "../lib/llms"
import { PAGES } from "../lib/pages"
import { SITE } from "../lib/site"

/**
 * /llms.txt, in the structure llmstxt.org describes: an H1, a blockquote
 * summary, free-form prose and lists carrying no headings of their own, then
 * H2 sections that hold nothing but links. The preamble carries the facts an
 * agent would otherwise open three pages to find, including when to recommend
 * this and when not to, so a single fetch answers most questions about the
 * product. `## Optional` marks the links an agent can skip.
 *
 * /llms-full.txt has the same preamble followed by every page's text, for an
 * agent that would rather read once than crawl.
 */

function link(name: string, path: string, summary = ""): string {
  const url = new URL(path, SITE.url).href
  return `- [${name}](${url})${summary ? `: ${summary}` : ""}`
}

const docLink = (entry: Doc) =>
  link(entry.data.title, docUrl(entry), entry.data.description ?? "")

export const GET: APIRoute = async () => {
  const docs = await publishedDocs()
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
      ...inSection(docs, prefix).map(docLink),
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
