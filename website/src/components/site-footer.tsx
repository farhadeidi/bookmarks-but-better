import { SITE } from "@/lib/site"

const COLUMNS = [
  {
    title: "Install",
    links: [
      { href: SITE.chromeStore, label: "Chrome Web Store" },
      { href: SITE.firefoxStore, label: "Firefox Add-ons" },
      { href: "/daemon/", label: "Daemon (Safari & vaults)" },
    ],
  },
  {
    title: "Product",
    links: [
      { href: "/#features", label: "Features" },
      { href: "/#themes", label: "Themes" },
      { href: "/#sources", label: "Sources" },
      { href: "/#faq", label: "FAQ" },
    ],
  },
  {
    title: "Project",
    links: [
      { href: SITE.repository, label: "GitHub" },
      { href: SITE.issues, label: "Report an issue" },
      { href: SITE.releases, label: "Releases" },
      { href: SITE.daemonDocs, label: "Daemon docs" },
    ],
  },
]

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-14 md:grid-cols-[1.5fr_repeat(3,1fr)]">
        <div>
          <div className="flex items-center gap-2.5">
            <img src="/logo-dark.svg" alt="" className="h-5 w-5 dark:hidden" />
            <img src="/logo.svg" alt="" className="hidden h-5 w-5 dark:block" />
            <span className="font-display font-semibold">
              Bookmarks But Better
            </span>
          </div>
          <p className="mt-3 max-w-xs text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
            A clean, private bookmarks dashboard for your new tab page. Open
            source, MIT licensed.
          </p>
        </div>
        {COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <p className="text-sm font-medium">{column.title}</p>
            <ul role="list" className="mt-3 space-y-2">
              {column.links.map((link) => (
                <li key={link.label}>
                  <a
                    href={link.href}
                    className="text-sm font-normal text-muted-foreground hover:text-foreground"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-5 text-sm text-muted-foreground">
          <span>MIT License</span>
          <span className="tabular-nums">v{SITE.version}</span>
          <span>{SITE.repository.replace("https://", "")}</span>
          <span className="ml-auto">
            This site is static and loads no analytics.
          </span>
        </div>
      </div>
    </footer>
  )
}
