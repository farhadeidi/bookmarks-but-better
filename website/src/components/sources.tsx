import { Section } from "@/components/section"

const SOURCES = [
  {
    name: "Browser bookmarks",
    tag: "Default",
    description:
      "Reads and edits the bookmarks you already have, through the browser's built-in APIs. Nothing to set up, nothing duplicated.",
  },
  {
    name: "Standalone collection",
    tag: "Private",
    description:
      "A separate collection that lives only in this browser profile. Your browser bookmarks are never touched.",
  },
  {
    name: "Markdown vault daemon",
    tag: "Power users",
    description:
      "Your bookmarks as plain Markdown files on disk, served by a small local daemon. The only source that works in Safari.",
  },
]

export function Sources() {
  return (
    <Section
      index="02"
      title="Three sources. Never silently mixed."
      id="sources"
    >
      <div className="grid gap-4 md:grid-cols-3">
        {SOURCES.map((source) => (
          <article
            key={source.name}
            className="rounded-lg border border-border bg-card p-6"
          >
            <span className="inline-block rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-[10px] font-medium tracking-wide text-primary uppercase">
              {source.tag}
            </span>
            <h3 className="font-display mt-4 text-lg font-medium tracking-tight">
              {source.name}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {source.description}
            </p>
          </article>
        ))}
      </div>
      <p className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="mt-0.5 size-4 shrink-0 text-primary"
        >
          <path d="M12 3 4 6v5c0 4.4 3.2 8.4 8 10 4.8-1.6 8-5.6 8-10V6l-8-3Z" />
        </svg>
        Operations affect only the active source. Switching sources never merges
        or moves bookmarks — what lives where is always your decision.
      </p>
    </Section>
  )
}
