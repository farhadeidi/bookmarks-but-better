import { Section } from "@/components/section"

const PLEDGES = [
  { title: "No account", text: "Nothing to register, nothing to log into." },
  {
    title: "No analytics",
    text: "No telemetry, no fingerprinting, no funnels.",
  },
  {
    title: "No tracking",
    text: "No ads, no trackers, no third-party scripts.",
  },
  {
    title: "No content collection",
    text: "Bookmark data stays in your browser profile or your own files.",
  },
]

export function PrivacyPledge() {
  return (
    <Section
      index="05"
      title="Private by design, not by policy update"
      id="privacy"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {PLEDGES.map((pledge) => (
          <div
            key={pledge.title}
            className="rounded-lg border border-border bg-card p-5"
          >
            <h3 className="font-display text-base font-medium">
              {pledge.title}
            </h3>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              {pledge.text}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-6 text-sm text-muted-foreground">
        The only network calls the extension makes are to a public favicon
        service (origins only, never full URLs) and — only if you connect one —
        to your own local daemon.{" "}
        <a
          href="/privacy/"
          className="text-foreground underline decoration-border underline-offset-4 transition-colors hover:text-primary"
        >
          Read the full privacy page
        </a>
        .
      </p>
    </Section>
  )
}
