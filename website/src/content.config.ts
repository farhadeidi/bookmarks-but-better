import { docsLoader } from "@astrojs/starlight/loaders"
import { docsSchema } from "@astrojs/starlight/schema"
import { defineCollection } from "astro:content"
import { glob } from "astro/loaders"
import { z } from "astro/zod"

export const collections = {
  // User docs, rendered by Starlight. They live under src/content/docs/docs/
  // so every page is served below /docs/.
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),

  // Plain GFM Markdown guides at /guides/<id>/.
  guides: defineCollection({
    loader: glob({ base: "./src/content/guides", pattern: "*.md" }),
    schema: z
      .object({
        /** At most 60 characters, without the brand suffix. */
        title: z.string().max(60),
        description: z.string().max(160),
        publishedAt: z.coerce.date(),
        updatedAt: z.coerce.date().optional(),
      })
      .strict(),
  }),
}
