import sitemap from "@astrojs/sitemap"
import starlight from "@astrojs/starlight"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, fontProviders } from "astro/config"
import { lastModified } from "./src/lib/lastmod"
import { SITE, THEME_COLORS } from "./src/lib/site"

/** Built pages that stay out of the sitemap. */
const UNLISTED_PATHS = new Set(["/404/", "/daemon/"])

const fontsourceVariable = (file: string) => `@fontsource-variable/${file}`

export default defineConfig({
  site: SITE.url,
  trailingSlash: "always",
  build: { format: "directory" },
  // Pages that moved. GitHub Pages has no server redirects, so these build as
  // small pages with a meta refresh and a canonical link to the new URL.
  redirects: {
    "/daemon": "/docs/daemon/",
  },
  // Starlight turns on prefetch-on-hover by default; the site ships no client
  // JavaScript beyond its few interactive controls.
  prefetch: false,

  // Self-hosted, latin-only fonts. Astro emits the @font-face rules, preload
  // links and metric-matched fallbacks. `optional` never swaps faces after
  // first paint: a font that misses the short block period (preloaded, it
  // rarely does) leaves that view on the fallback, and the next page has it.
  // One face for the whole site. The `opsz` build carries both the weight and
  // the optical size axes in the single file the `wght` build used, so display
  // sizes get the Display drawing (tighter spacing, finer joints) for free.
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Inter",
      cssVariable: "--font-inter",
      // The system UI face (SF, Segoe UI, Roboto) is closer to Inter than Arial.
      fallbacks: ["system-ui"],
      display: "optional",
      options: {
        variants: [
          {
            src: [
              fontsourceVariable("inter/files/inter-latin-opsz-normal.woff2"),
            ],
            weight: "100 900",
            style: "normal",
          },
        ],
      },
    },
  ],

  integrations: [
    starlight({
      title: SITE.name,
      description:
        "Documentation for Bookmarks But Better: install the extension, choose sources, import and export, and keep bookmarks as Markdown with the local daemon.",
      titleDelimiter: "—",
      // Read from git history, so docs carry a date a reader and a crawler
      // can both trust. Needs a full checkout; see src/lib/lastmod.ts.
      lastUpdated: true,
      favicon: "/favicon.svg",
      // The site's own 404 page serves every missing URL, docs included.
      disable404Route: true,
      customCss: ["./src/styles/global.css", "./src/styles/starlight.css"],
      social: [{ icon: "github", label: "GitHub", href: SITE.repository }],
      editLink: { baseUrl: `${SITE.repository}/edit/main/website/` },
      sidebar: [
        {
          label: "Getting started",
          items: [{ autogenerate: { directory: "docs/start" } }],
        },
        {
          label: "Markdown vaults",
          items: [{ autogenerate: { directory: "docs/daemon" } }],
        },
        {
          label: "Guides",
          items: [{ autogenerate: { directory: "docs/guides" } }],
        },
      ],
      head: [
        // llmstxt.org asks for the plain-text summary to be discoverable
        // through a standard link relation. Starlight only deduplicates
        // canonical and sitemap links, so this passes through on every page.
        {
          tag: "link",
          attrs: {
            rel: "alternate",
            type: "text/plain",
            href: "/llms.txt",
            title: "llms.txt",
          },
        },
        {
          tag: "link",
          attrs: {
            rel: "alternate",
            type: "text/plain",
            href: "/llms-full.txt",
            title: "llms-full.txt",
          },
        },
        { tag: "meta", attrs: { property: "og:image", content: SITE.ogImage } },
        { tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
        { tag: "meta", attrs: { property: "og:image:height", content: "630" } },
        {
          tag: "meta",
          attrs: { property: "og:image:alt", content: SITE.ogImageAlt },
        },
        {
          tag: "meta",
          attrs: { name: "twitter:image", content: SITE.ogImage },
        },
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            media: "(prefers-color-scheme: light)",
            content: THEME_COLORS.light,
          },
        },
        {
          tag: "meta",
          attrs: {
            name: "theme-color",
            media: "(prefers-color-scheme: dark)",
            content: THEME_COLORS.dark,
          },
        },
      ],
      components: {
        Head: "./src/components/starlight/Head.astro",
        Header: "./src/components/starlight/Header.astro",
        PageTitle: "./src/components/starlight/PageTitle.astro",
        ContentPanel: "./src/components/starlight/ContentPanel.astro",
        MarkdownContent: "./src/components/starlight/MarkdownContent.astro",
        Footer: "./src/components/starlight/Footer.astro",
        ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
        SiteTitle: "./src/components/starlight/SiteTitle.astro",
        SocialIcons: "./src/components/starlight/SocialIcons.astro",
        MobileMenuFooter: "./src/components/starlight/MobileMenuFooter.astro",
      },
    }),
    sitemap({
      filter: (page) => !UNLISTED_PATHS.has(new URL(page).pathname),
      serialize: (item) => {
        const lastmod = lastModified(new URL(item.url).pathname)
        return lastmod ? { ...item, lastmod } : item
      },
    }),
  ],

  vite: {
    plugins: [
      tailwindcss(),
      {
        // Dev-only: the dev server does not resolve public/preview/app/ to its
        // index.html, which GitHub Pages and the built site do. (/preview/
        // itself is an Astro page and needs no help.)
        name: "serve-preview-index",
        apply: "serve",
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url && /^\/preview\/app\/(\?.*)?$/.test(req.url)) {
              req.url = req.url.replace(
                "/preview/app/",
                "/preview/app/index.html"
              )
            }
            next()
          })
        },
      },
    ],
  },
})
