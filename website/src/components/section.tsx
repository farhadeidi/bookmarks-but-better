import type { ReactNode } from "react"
import { cn } from "@/lib/cn"

interface SectionProps {
  index: string
  title: string
  id?: string
  className?: string
  children: ReactNode
}

export function Section({
  index,
  title,
  id,
  className,
  children,
}: SectionProps) {
  return (
    <section id={id} className={cn("border-t border-border", className)}>
      <div className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <div className="flex items-center gap-4">
          <p className="font-display text-sm text-primary italic">{index} —</p>
          <span className="h-px flex-1 bg-border" aria-hidden />
        </div>
        <h2 className="font-display mt-4 max-w-[40ch] text-3xl font-medium tracking-tight text-balance md:text-4xl">
          {title}
        </h2>
        <div className="mt-10">{children}</div>
      </div>
    </section>
  )
}
