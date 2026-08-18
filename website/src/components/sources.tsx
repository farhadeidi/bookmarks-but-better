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
    tag: "Legacy",
    description:
      "A separate collection that lives only in this browser profile. It is retiring over one major version; migration to a vault is an explicit copy.",
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
      <dl className="grid gap-4 md:grid-cols-3">
        {SOURCES.map((source) => (
          <div
            key={source.name}
            className="rounded-lg bg-card p-6 ring-1 ring-border"
          >
            <dt className="flex flex-wrap items-center gap-3">
              <span className="font-display text-lg font-medium tracking-tight">
                {source.name}
              </span>
              <span className="rounded-full border border-primary/30 bg-primary/5 px-2.5 py-1 text-sm text-primary">
                {source.tag}
              </span>
            </dt>
            <dd className="mt-2 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
              {source.description}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-6 flex items-start gap-3 rounded-lg bg-muted/40 p-4 text-base/7 text-pretty text-muted-foreground ring-1 ring-border sm:text-sm/6">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          strokeWidth="1.8"
          className="mt-0.5 size-4 shrink-0 stroke-primary"
          aria-hidden
        >
          <path d="M12 3 4 6v5c0 4.4 3.2 8.4 8 10 4.8-1.6 8-5.6 8-10V6l-8-3Z" />
        </svg>
        Operations affect only the active source. Switching sources never merges
        or moves bookmarks — what lives where is always your decision.
      </p>
    </Section>
  )
}
