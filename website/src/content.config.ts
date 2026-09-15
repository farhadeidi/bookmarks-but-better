import { docsLoader } from "@astrojs/starlight/loaders"
import { docsSchema } from "@astrojs/starlight/schema"
import { defineCollection } from "astro:content"

export const collections = {
  // User docs and guides, rendered by Starlight. They live under
  // src/content/docs/docs/ so every page is served below /docs/.
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
}
