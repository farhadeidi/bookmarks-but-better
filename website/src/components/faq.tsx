import { Section } from "@/components/section"
import { FAQ_ITEMS } from "@/lib/faq-items"

export function Faq() {
  return (
    <Section index="06" title="Questions, answered" id="faq">
      <div className="divide-y divide-border rounded-lg border border-border bg-card">
        {FAQ_ITEMS.map((item) => (
          <details key={item.question} className="group px-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-sm font-medium marker:hidden">
              {item.question}
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-45"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
            </summary>
            <p className="pb-4 text-sm leading-relaxed text-muted-foreground">
              {item.answer}
            </p>
          </details>
        ))}
      </div>
    </Section>
  )
}
