/**
 * The header's section links. Every page renders through Starlight, so one
 * header serves the marketing pages and the docs, and these links also fill
 * the mobile menus.
 *
 * Five labels beside the brand, search, GitHub, the theme toggle and the
 * install button need about 1100px, so that — not Starlight's 50rem — is where
 * the row appears; below it every link lives in the menu instead
 * (Header.astro). "Demo" is the widest label /preview/ can afford even there.
 */
export const SITE_LINKS = [
  { href: "/", label: "Home" },
  { href: "/preview/", label: "Demo" },
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
