import { existsSync } from "node:fs"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import pkg from "../package.json"

function productVersionPlugin() {
  return {
    name: "replace-product-version",
    transformIndexHtml(html: string) {
      return html.replaceAll("__APP_VERSION__", pkg.version)
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    productVersionPlugin(),
    {
      // Dev-only: serve the prebuilt live-preview app (public/app-preview) at
      // /app-preview/ — the SPA fallback would otherwise claim the path. The
      // marketing page lives at /preview/.
      name: "serve-live-preview",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          // Only the directory form (with trailing slash) is the embedded
          // app; "/preview/" is the site's full-screen marketing page.
          if (req.url && /^\/app-preview\/(\?.*)?$/.test(req.url)) {
            const file = path.resolve(
              __dirname,
              "public/app-preview/index.html"
            )
            if (existsSync(file)) {
              req.url = "/app-preview/index.html"
            }
          }
          next()
        })
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      input: {
        landing: path.resolve(__dirname, "index.html"),
        privacy: path.resolve(__dirname, "privacy/index.html"),
        daemon: path.resolve(__dirname, "daemon/index.html"),
        preview: path.resolve(__dirname, "preview/index.html"),
      },
    },
  },
})
