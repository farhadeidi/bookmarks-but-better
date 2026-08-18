const ITEMS = [
  "No account",
  "No analytics or tracking",
  "Open source, MIT",
  "Local-first data",
  "Free forever",
]

const CHECK = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    className="size-4 shrink-0 stroke-primary"
    aria-hidden
  >
    <path d="m20 6-11 11-5-5" />
  </svg>
)

export function TrustStrip() {
  return (
    <section className="border-t border-border">
      <ul
        role="list"
        className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-6"
      >
        {ITEMS.map((item) => (
          <li
            key={item}
            className="flex items-center gap-2 text-muted-foreground"
          >
            {CHECK}
            <span className="text-sm font-medium">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
