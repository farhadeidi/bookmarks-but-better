// Serves the built website (website/dist) the way GitHub Pages does:
// directory indexes, a redirect to the trailing-slash URL for a directory,
// and the site's own 404.html, with a 404 status, for anything else.
import { createReadStream, statSync } from "node:fs"
import { createServer } from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("../../website/dist", import.meta.url))
const PORT = 5180

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
}

function stat(file) {
  try {
    return statSync(file)
  } catch {
    return null
  }
}

function send(response, status, file) {
  response.writeHead(status, {
    "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream",
  })
  createReadStream(file).pipe(response)
}

createServer((request, response) => {
  const { pathname } = new URL(request.url ?? "/", "http://localhost")
  const target = path.join(ROOT, decodeURIComponent(pathname))
  if (!target.startsWith(ROOT)) {
    response.writeHead(400).end()
    return
  }

  const found = stat(target)
  if (found?.isDirectory()) {
    if (!pathname.endsWith("/")) {
      response.writeHead(301, { Location: `${pathname}/` }).end()
      return
    }
    const index = path.join(target, "index.html")
    if (stat(index)) return send(response, 200, index)
  } else if (found) {
    return send(response, 200, target)
  }
  send(response, 404, path.join(ROOT, "404.html"))
}).listen(PORT, "127.0.0.1")
