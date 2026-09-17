import type { APIRoute } from "astro"
import {
  DOCS_SECTIONS,
  docUrl,
  inSidebarOrder,
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
 * The bodies are the authored Markdown. MDX pages also carry a few Starlight
 * components, which `plainMarkdown` below reduces to their text: everything
 * this site uses them for (tabs, card grids, link cards) is a wrapper around
 * Markdown that reads fine without the wrapper.
 */

/** Starlight components this site uses, as they appear at the start of a tag. */
const COMPONENT_TAG =
  /^\s*<\/?(Tabs|TabItem|CardGrid|LinkCard|Card|Aside|Steps|Badge|FileTree)\b[^>]*>\s*$/

const TAB_LABEL = /^\s*<TabItem\s[^>]*label=["']([^"']+)["'][^>]*>\s*$/

function plainMarkdown(body: string): string {
  return body
    .split("\n")
    .flatMap((line) => {
      if (/^import\s.*from\s.*$/.test(line)) return []
      const tab = line.match(TAB_LABEL)
      if (tab) return [`**${tab[1]}**`, ""]
      if (COMPONENT_TAG.test(line)) return []
      return [line]
    })
    .join("\n")
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
  const inSection = (prefix: string) =>
    docs.filter((entry) => `${entry.id}/`.startsWith(prefix))

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
      ...inSection(prefix).sort(inSidebarOrder).map(section),
    ]),
  ]

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
