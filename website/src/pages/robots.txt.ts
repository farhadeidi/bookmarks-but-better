import type { APIRoute } from "astro"
import { SITE } from "../lib/site"

/**
 * Every crawler is welcome. The site is marketing copy and MIT-licensed
 * documentation about a privacy tool, not anyone's data: being readable — by
 * search engines, by AI assistants that cite sources, and by the crawlers that
 * gather training data — is how people find out the project exists. The
 * privacy promise is about bookmarks, not about public web pages.
 *
 * The named groups below are declarative: `User-agent: *` already allows all
 * of them. They state the intent, and they keep a later `Disallow:` under `*`
 * from silently removing the site from AI answers. Each one repeats its rules
 * because a named group inherits nothing from `*` (RFC 9309): naming a crawler
 * and leaving its group empty is the usual way a site blocks a bot by accident.
 *
 * `/preview/app/` is deliberately not disallowed: the app frame carries a
 * `noindex` meta tag, and a crawler has to be allowed to fetch a page to see it.
 */
const GROUPS = [
  {
    comment: "AI search and assistants, so their answers can cite and link us.",
    agents: [
      "OAI-SearchBot",
      "ChatGPT-User",
      "Claude-SearchBot",
      "Claude-User",
      "PerplexityBot",
      "Perplexity-User",
      "Applebot",
    ],
  },
  {
    comment: "Crawlers that gather training data. Also welcome.",
    agents: [
      "GPTBot",
      "ClaudeBot",
      "Google-Extended",
      "Applebot-Extended",
      "CCBot",
      "meta-externalagent",
    ],
  },
]

export const GET: APIRoute = () =>
  new Response(
    [
      "User-agent: *",
      "Allow: /",
      "",
      ...GROUPS.flatMap(({ comment, agents }) => [
        `# ${comment}`,
        ...agents.map((agent) => `User-agent: ${agent}`),
        "Allow: /",
        "",
      ]),
      `Sitemap: ${new URL("/sitemap-index.xml", SITE.url).href}`,
      "",
    ].join("\n"),
    { headers: { "Content-Type": "text/plain; charset=utf-8" } }
  )
