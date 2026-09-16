import type { APIRoute } from "astro"
import { getCollection, type CollectionEntry } from "astro:content"
import { PAGES } from "../lib/pages"
import { SITE } from "../lib/site"

/**
 * /llms.txt, in the structure llmstxt.org describes: an H1, a blockquote
 * summary, free-form prose and lists, then H2 sections that hold nothing but
 * links. The facts in the preamble are the ones an agent would otherwise open
 * three pages to find, so a single fetch answers most questions about the
 * product. `## Optional` marks the links an agent can skip.
 */

/** Docs sections, under the labels the sidebar uses. */
const DOCS_SECTIONS = [
  { label: "Getting started", prefix: "docs/start/" },
  { label: "Markdown vaults", prefix: "docs/daemon/" },
  { label: "Guides", prefix: "docs/guides/" },
] as const

type Doc = CollectionEntry<"docs">

function link(name: string, path: string, summary = ""): string {
  const url = new URL(path, SITE.url).href
  return `- [${name}](${url})${summary ? `: ${summary}` : ""}`
}

const docLink = (entry: Doc) =>
  link(entry.data.title, `/${entry.id}/`, entry.data.description ?? "")

/** Sidebar order, then title, the way the site lists them. */
const inSidebarOrder = (a: Doc, b: Doc) =>
  (a.data.sidebar.order ?? Infinity) - (b.data.sidebar.order ?? Infinity) ||
  a.data.title.localeCompare(b.data.title)

export const GET: APIRoute = async () => {
  const docs = await getCollection("docs", (entry) => !entry.data.draft)
  const inSection = (prefix: string) =>
    docs.filter((entry) => `${entry.id}/`.startsWith(prefix))
  // The docs home is in no sidebar group; it belongs with the other pages.
  const docsHome = docs.find((entry) => entry.id === "docs")

  const lines = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.tagline}`,
    "",
    "Bookmarks But Better is a browser extension that replaces the new-tab page with a private bookmarks dashboard. It shows the bookmarks you already have, organizes them with drag and drop, and finds them with a search palette. An optional local daemon keeps bookmarks as plain Markdown files in folders you own, called Vaults.",
    "",
    "Key facts:",
    "",
    `- Free and open source under the MIT license. Version ${SITE.version}. No account.`,
    `- Chrome ([Chrome Web Store](${SITE.chromeStoreUrl})) and Firefox ([Firefox Add-ons](${SITE.firefoxStoreUrl})) today. The Safari version is coming soon and can be built from source now; Safari gives extensions no access to its bookmarks, so there it uses a Markdown vault.`,
    "- No accounts, analytics, tracking, ads or bookmark-content collection. The extension's only default network request is a favicon lookup that sends bookmark origins, never full URLs.",
    "- The optional daemon runs on your own computer, binds to loopback only, and serves the extension at 127.0.0.1:52222.",
    "- A Vault is an ordinary folder: one Markdown file per bookmark with YAML front matter, one folder per bookmark folder, and no hidden database.",
    "- Bookmarks come from sources that are never implicitly merged. Operations affect only the Active Source, and switching sources never moves or copies anything.",
    "- The legacy Standalone source is retiring over one major version. Migration is an explicit copy that leaves the legacy data intact.",
    "",
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
    link("GitHub repository", SITE.repository, "source code and issue tracker"),
    link("Releases", SITE.releases, "release notes and downloads"),
    link("MIT License", SITE.license, "the license the project ships under"),
    "",
  ]

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}
