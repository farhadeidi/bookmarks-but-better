import path from "path"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "vite"
import pkg from "../package.json"

/**
 * Builds the real application — unchanged — as a static "live preview" page
 * embedded in the marketing site's hero iframe at /app-preview/.
 *
 * `vite build --mode development` is deliberate: the app's SourceEnvironment
 * seam folds on `import.meta.env.DEV`, so a development-mode build keeps the
 * Dev Workbench's simulated sources (deterministic scenario seeds, IndexedDB
 * persistence, no extension, no daemon) that the workbench itself runs on.
 * Everything else is forced back to production behavior: React is aliased to
 * its prebuilt production files (one shared copy for the document) and output
 * is minified.
 */

const rootDir = path.resolve(__dirname, "..")

export default defineConfig({
  // Rooted at app-frame/ so the emitted html and assets both land under
  // public/app-preview/, separate from the marketing page at /preview/.
  root: path.resolve(__dirname, "app-frame"),
  base: "/app-preview/",
  // Mode is development (see header comment) — keep the JSX transform on the
  // production runtime so bundles stay lean.
  esbuild: { jsxDev: false },
  plugins: [tailwindcss()],
  resolve: {
    alias: [
      {
        find: /^@\/(.*)$/,
        replacement: path.join(rootDir, "src/$1"),
      },
      // The real app, unchanged — but pinned to React's prebuilt production
      // files, so a development-mode build (simulated world kept) still ships
      // the production React runtime with one shared copy for the document.
      {
        find: /^react$/,
        replacement: path.join(
          rootDir,
          "node_modules/react/cjs/react.production.js"
        ),
      },
      {
        find: /^react\/jsx-runtime$/,
        replacement: path.join(
          rootDir,
          "node_modules/react/cjs/react-jsx-runtime.production.js"
        ),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: path.join(
          rootDir,
          "node_modules/react/cjs/react-jsx-dev-runtime.production.js"
        ),
      },
      {
        find: /^react-dom$/,
        replacement: path.join(
          rootDir,
          "node_modules/react-dom/cjs/react-dom.production.js"
        ),
      },
      {
        find: /^react-dom\/client$/,
        replacement: path.join(
          rootDir,
          "node_modules/react-dom/cjs/react-dom-client.production.js"
        ),
      },
    ],
  },
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __MARKETING_PREVIEW__: JSON.stringify(true),
    // Vite folds `import.meta.env.DEV` to false in every build, which would
    // eliminate the simulated world at the app's environment seam. This build
    // exists to keep it: fold DEV back to true (mode is `development`, never
    // `test`, so the app's guard holds) while everything else runs production.
    "import.meta.env.DEV": "true",
    // Third-party libraries key their dev warnings on NODE_ENV; this is a
    // production artifact.
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
  build: {
    minify: "esbuild",
    sourcemap: false,
    rollupOptions: {
      onwarn(warning, warn) {
        // The app and Base UI both use client-boundary directives. They are
        // harmless in this static browser bundle, but otherwise flood builds
        // with warnings because the preview is rooted outside the app source.
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" ||
          warning.code === "SOURCEMAP_ERROR"
        ) {
          return
        }
        warn(warning)
      },
    },
    outDir: path.resolve(__dirname, "public/app-preview"),
    emptyOutDir: true,
  },
})
