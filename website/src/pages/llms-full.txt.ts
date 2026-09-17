import type { APIRoute } from "astro"
import {
  DOCS_SECTIONS,
  docUrl,
  inSection,
  OVERVIEW,
  publishedDocs,
  type Doc,
} from "../lib/llms"
import { SITE } from "../lib/site"

/**
 * /llms-full.txt: the same preamble as /llms.txt, then the text of every
 * documentation page, so an agent can read the whole product in one fetch
 * instead of following eighteen links.
 *
 * The bodies are the authored Markdown, with the MDX components reduced to
 * their text by `plainMarkdown` below.
 */

/**
 * Starlight components wrap Markdown; their text is what matters here.
 *
 * A LinkCard carries its own content in attributes and is the whole body of
 * the two index pages, so it becomes the link it renders rather than being
 * dropped. A TabItem's label is a heading for the block under it. Everything
 * else is a wrapper and goes.
 *
 * The tags span lines, so these run over the whole document rather than line
 * by line. No fenced code block in the docs contains a capitalised angle tag,
 * which is what would otherwise be caught by the last pattern.
 */
const IMPORT = /^import\s.*$/gm
const LINK_CARD = /[ \t]*<LinkCard\b([^>]*?)\/>/g
const TAB_ITEM = /<TabItem\b[^>]*?\blabel=["']([^"']+)["'][^>]*?>/g
const COMPONENT_TAG = /<\/?[A-Z][A-Za-z]*\b[^>]*?\/?>/g

/** The value of one JSX attribute, from the attribute text of a tag. */
function attribute(attributes: string, name: string): string {
  return attributes.match(new RegExp(`\\b${name}=["']([^"']*)["']`))?.[1] ?? ""
}

function plainMarkdown(body: string): string {
  return body
    .replace(IMPORT, "")
    .replace(LINK_CARD, (_, attributes: string) => {
      const title = attribute(attributes, "title")
      const href = attribute(attributes, "href")
      const description = attribute(attributes, "description")
      return `- [${title}](${href})${description ? `: ${description}` : ""}`
    })
    .replace(TAB_ITEM, (_, label: string) => `\n**${label}**\n`)
    .replace(COMPONENT_TAG, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const section = (entry: Doc) =>
  [
    `## ${entry.data.title}`,
    "",
    `Source: ${docUrl(entry)}`,
    ...(entry.data.description ? ["", entry.data.description] : []),
    "",
    plainMarkdown(entry.body ?? ""),
    "",
  ].join("\n")

export const GET: APIRoute = async () => {
  const docs = await publishedDocs()
  const docsHome = docs.filter((entry) => entry.id === "docs")

  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.tagline}`,
    "",
    ...OVERVIEW,
    "# Documentation",
    "",
    `Every documentation page at ${SITE.url}/docs/, in sidebar order.`,
    "",
    ...docsHome.map(section),
    ...DOCS_SECTIONS.flatMap(({ label, prefix }) => [
      `# ${label}`,
      "",
      ...inSection(docs, prefix).map(section),
    ]),
  ]

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
