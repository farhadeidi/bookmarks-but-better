import * as React from "react"

/**
 * The building blocks every settings panel is laid out with: a muted section
 * heading, a bordered group, and rows that put the label and its explanation
 * on the left and the control on the right.
 */

export function SettingSection({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
      {children}
    </section>
  )
}

export function SettingGroup({ children }: { children: React.ReactNode }) {
  return (
    <div className="divide-y divide-border/60 overflow-hidden rounded-xl bg-card ring-1 ring-border/60">
      {children}
    </div>
  )
}

export function SettingRow({
  title,
  description,
  control,
  htmlFor,
}: {
  title: string
  description?: React.ReactNode
  control: React.ReactNode
  /** The control's id, so the title labels it for assistive technology. */
  htmlFor?: string
}) {
  const Title = htmlFor ? "label" : "span"
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <Title htmlFor={htmlFor} className="text-sm font-medium">
          {title}
        </Title>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">{control}</div>
    </div>
  )
}
