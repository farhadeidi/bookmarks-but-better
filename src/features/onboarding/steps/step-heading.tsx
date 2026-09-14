import * as React from "react"

/** The title and one-line explanation every setup step opens with. */
export function StepHeading({
  title,
  description,
}: {
  title: string
  description: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
      <p className="text-sm text-muted-foreground">{description}</p>
    </div>
  )
}
