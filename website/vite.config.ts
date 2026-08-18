import path from "path"
import { existsSync } from "node:fs"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      // Dev-only: serve the prebuilt live-preview app (public/preview) at
      // /preview/ — the SPA fallback would otherwise claim the path. The
      // production host serves the static file directly.
      name: "serve-live-preview",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          // Only the directory form (with trailing slash) is the embedded
          // app; "/preview" (no slash) is the site's own page.
          if (req.url && /^\/preview\/(\?.*)?$/.test(req.url)) {
            const file = path.resolve(__dirname, "public/preview/index.html")
            if (existsSync(file)) {
              req.url = "/preview/index.html"
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
        privacy: path.resolve(__dirname, "privacy.html"),
        daemon: path.resolve(__dirname, "daemon.html"),
        preview: path.resolve(__dirname, "preview.html"),
      },
    },
  },
})
