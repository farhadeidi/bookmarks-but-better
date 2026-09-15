/**
 * The header's section links. Every page renders through Starlight, so one
 * header serves the marketing pages and the docs, and these links also fill
 * the mobile menus.
 */
export const SITE_LINKS = [
  { href: "/", label: "Home" },
  { href: "/docs/", label: "Docs" },
  { href: "/docs/guides/", label: "Guides" },
  { href: "/privacy/", label: "Privacy" },
] as const

/**
 * The link for the section a page belongs to. The last matching prefix wins,
 * so a guide marks Guides rather than Docs. Home is the homepage itself, not
 * the prefix of every path, so it only marks `/`.
 */
export function currentSiteLink(url: URL): string | undefined {
  return SITE_LINKS.filter((link) =>
    link.href === "/"
      ? url.pathname === "/"
      : url.pathname.startsWith(link.href)
  ).at(-1)?.href
}

/**
 * Pages under /docs/ use Starlight's own content layout. Everything else is a
 * marketing page that lays out its own full-width content and footer.
 */
export function isDocsPage(url: URL): boolean {
  return url.pathname.startsWith("/docs/")
}
