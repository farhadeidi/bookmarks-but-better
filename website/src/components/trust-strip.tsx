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
    stroke="currentColor"
    strokeWidth="2"
    className="size-3 shrink-0"
  >
    <path d="m20 6-11 11-5-5" />
  </svg>
)

export function TrustStrip() {
  return (
    <section className="border-t border-border">
      <ul className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 py-6">
        {ITEMS.map((item) => (
          <li
            key={item}
            className="flex items-center gap-2 text-muted-foreground"
          >
            <span className="text-primary">{CHECK}</span>
            <span className="text-xs font-medium tracking-wide uppercase">
              {item}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
