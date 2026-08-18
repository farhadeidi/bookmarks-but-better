import { Section } from "@/components/section"
import { FAQ_ITEMS } from "@/lib/faq-items"

export function Faq() {
  return (
    <Section index="06" title="Questions, answered" id="faq">
      <div className="divide-y divide-border rounded-lg bg-card ring-1 ring-border">
        {FAQ_ITEMS.map((item) => (
          <details key={item.question} className="group px-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base font-medium marker:hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:text-sm">
              {item.question}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                strokeWidth="1.8"
                className="size-4 shrink-0 stroke-muted-foreground transition-transform group-open:rotate-45"
                aria-hidden
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </summary>
            <p className="pb-4 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </Section>
  )
}
