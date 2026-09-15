import sitemap from "@astrojs/sitemap"
import starlight from "@astrojs/starlight"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, fontProviders } from "astro/config"
import { SITE, THEME_COLORS } from "./src/lib/site"

/** Built pages that stay out of the sitemap. */
const UNLISTED_PATHS = new Set(["/preview/", "/404/"])

const fontsource = (file: string) => `@fontsource-variable/${file}`

export default defineConfig({
  site: SITE.url,
  trailingSlash: "always",
  build: { format: "directory" },
  // Starlight turns on prefetch-on-hover by default; the site ships no client
  // JavaScript beyond its few interactive controls.
  prefetch: false,

  // Self-hosted, latin-only variable fonts. Astro emits the @font-face rules,
  // preload links and metric-matched fallbacks.
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Fraunces",
      cssVariable: "--font-fraunces",
      fallbacks: ["Georgia", "serif"],
      options: {
        variants: [
          {
            src: [
              fontsource("fraunces/files/fraunces-latin-wght-normal.woff2"),
            ],
            weight: "100 900",
            style: "normal",
          },
          {
            src: [
              fontsource("fraunces/files/fraunces-latin-wght-italic.woff2"),
            ],
            weight: "100 900",
            style: "italic",
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: "Inter",
      cssVariable: "--font-inter",
      fallbacks: ["sans-serif"],
      options: {
        variants: [
          {
            src: [fontsource("inter/files/inter-latin-wght-normal.woff2")],
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
      favicon: "/favicon.svg",
      // The site's own 404 page serves every missing URL, docs included.
      disable404Route: true,
      customCss: ["./src/styles/starlight.css"],
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
      ],
      head: [
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
        ThemeProvider: "./src/components/starlight/ThemeProvider.astro",
        ThemeSelect: "./src/components/starlight/ThemeSelect.astro",
        SiteTitle: "./src/components/starlight/SiteTitle.astro",
      },
    }),
    sitemap({
      filter: (page) => !UNLISTED_PATHS.has(new URL(page).pathname),
    }),
  ],

  vite: {
    plugins: [
      tailwindcss(),
      {
        // Dev-only: the dev server does not resolve public/app-preview/ to its
        // index.html, which GitHub Pages and the built site do.
        name: "serve-app-preview-index",
        apply: "serve",
        configureServer(server) {
          server.middlewares.use((req, _res, next) => {
            if (req.url && /^\/app-preview\/(\?.*)?$/.test(req.url)) {
              req.url = req.url.replace(
                "/app-preview/",
                "/app-preview/index.html"
              )
            }
            next()
          })
        },
      },
    ],
  },
})
