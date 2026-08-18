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
      <dl className="grid gap-x-4 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        {PLEDGES.map((pledge) => (
          <div key={pledge.title} className="border-t-2 border-primary/60 pt-4">
            <dt className="font-display text-base font-medium">
              {pledge.title}
            </dt>
            <dd className="mt-1.5 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
              {pledge.text}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-10 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
        The only network calls the extension makes are to a public favicon
        service (origins only, never full URLs) and — only if you connect one —
        to your own local daemon.{" "}
        <a
          href="/privacy/"
          className="text-foreground underline decoration-border underline-offset-4 hover:text-primary"
        >
          Read the full privacy page
        </a>
        .
      </p>
    </Section>
  )
}
