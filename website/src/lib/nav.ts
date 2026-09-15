/**
 * The site's header links. Every page renders through Starlight, so one header
 * serves the marketing pages and the docs: its title links home and to /docs/,
 * and these links follow it (and fill the mobile menu).
 */
export const SITE_LINKS = [
  { href: "/preview/", label: "Live preview" },
  { href: "/docs/", label: "Docs" },
  { href: "/docs/guides/", label: "Guides" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/docs/start/install/", label: "Install" },
] as const

/**
 * Pages under /docs/ use Starlight's own content layout. Everything else is a
 * marketing page that lays out its own full-width content and footer.
 */
export function isDocsPage(url: URL): boolean {
  return url.pathname.startsWith("/docs/")
}
