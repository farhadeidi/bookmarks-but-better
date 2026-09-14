/**
 * The Scenario Workbench: the dev-only control surface for the simulated
 * world. URL-addressable scenarios, a deterministic reset, and the failure
 * controls — all against the same runtime the dev SourceEnvironment reads,
 * so a toggle here changes what the very next application operation sees.
 *
 * Development-only by construction: the only import site is `App.tsx`, behind
 * an inline `import.meta.env.DEV && import.meta.env.MODE !== "test"` guard
 * (a build-time constant, so it folds and rollup eliminates this chunk from
 * production bundles) and a lazy import. Never guard a dynamic-import site
 * with `devWorkbenchEnabled()` — the function call would defeat the
 * constant folding and ship the dev chunk in production.
 */

import * as React from "react"
import { ArrowDown01Icon } from "@hugeicons/core-free-icons"
import { HugeiconsIcon } from "@hugeicons/react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  DEV_SCENARIOS,
  DEFAULT_SCENARIO_ID,
  type DevScenario,
} from "@/dev/scenarios"
import {
  resetScenario,
  runtimeSnapshot,
  setFaults,
  subscribeRuntime,
} from "@/dev/runtime"
import { LATENCY_CHOICES } from "@/dev/state"

/** Display grouping only; a scenario missing here still shows, under "Other". */
const SCENARIO_GROUPS: { title: string; ids: string[] }[] = [
  {
    title: "Sources",
    ids: ["browser-daemon", "browser-only", "multi-vault", "safari"],
  },
  { title: "Daemon states", ids: ["daemon-offline", "slow-daemon"] },
  {
    title: "First run",
    ids: ["fresh-chrome", "fresh-safari", "empty", "legacy-standalone"],
  },
  { title: "Scale", ids: ["large-library", "huge-library", "large-tree"] },
]

function groupedScenarios(): { title: string; scenarios: DevScenario[] }[] {
  const grouped = new Set(SCENARIO_GROUPS.flatMap((group) => group.ids))
  const groups = SCENARIO_GROUPS.map((group) => ({
    title: group.title,
    scenarios: DEV_SCENARIOS.filter((s) => group.ids.includes(s.id)),
  }))
  const other = DEV_SCENARIOS.filter((s) => !grouped.has(s.id))
  if (other.length > 0) groups.push({ title: "Other", scenarios: other })
  return groups.filter((group) => group.scenarios.length > 0)
}

function formatLatency(ms: number) {
  if (ms === 0) return "none"
  return ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`
}

function useDevRuntime() {
  return React.useSyncExternalStore(
    subscribeRuntime,
    runtimeSnapshot,
    runtimeSnapshot
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">
      {children}
    </h2>
  )
}

function FaultRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60"
    >
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{hint}</span>
      </span>
      <Switch
        id={id}
        aria-label={label}
        checked={checked}
        onCheckedChange={onChange}
      />
    </label>
  )
}

export function ScenarioWorkbench() {
  const runtime = useDevRuntime()
  const [open, setOpen] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  const scenario =
    DEV_SCENARIOS.find((s) => s.id === runtime.scenarioId) ??
    DEV_SCENARIOS.find((s) => s.id === DEFAULT_SCENARIO_ID)!

  const run = (action: () => Promise<void>) => {
    setBusy(true)
    void action().finally(() => setBusy(false))
  }

  if (!open) {
    return (
      <button
        type="button"
        aria-label="Open Dev Workbench"
        onClick={() => setOpen(true)}
        className="fixed bottom-24 left-4 z-10 inline-flex min-h-12 items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-2.5 text-base font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground sm:bottom-6 sm:left-6 sm:min-h-0 sm:py-1.5 sm:text-xs"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-violet-500" />
        Dev Workbench
        <span className="max-w-32 truncate text-foreground/70">
          · {scenario.label}
        </span>
      </button>
    )
  }

  const faults = runtime.faults

  return (
    <aside
      aria-label="Dev Workbench"
      className="fixed right-4 bottom-24 left-4 z-10 flex max-h-[calc(100svh-7rem)] w-auto flex-col rounded-2xl border border-border/60 bg-background/95 text-sm shadow-lg backdrop-blur-sm sm:right-auto sm:bottom-6 sm:left-6 sm:max-h-[80svh] sm:w-80 sm:text-xs"
    >
      <header className="flex items-center gap-2 border-b border-border/60 py-2 pr-2 pl-4">
        <span aria-hidden className="size-1.5 rounded-full bg-violet-500" />
        <span className="flex-1 text-sm font-semibold text-foreground">
          Dev Workbench
        </span>
        <Button
          variant="outline"
          size="xs"
          disabled={busy}
          aria-label="Reset scenario"
          title="Restore the scenario's seed data and reload"
          onClick={() => run(() => resetScenario())}
        >
          Reset
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close Dev Workbench"
          onClick={() => setOpen(false)}
        >
          <HugeiconsIcon icon={ArrowDown01Icon} strokeWidth={2} />
        </Button>
      </header>

      {/* Nested flex columns let the viewport shrink to the panel's max height. */}
      <ScrollArea className="flex min-h-0 flex-1 flex-col *:data-[slot=scroll-area-viewport]:min-h-0 *:data-[slot=scroll-area-viewport]:flex-1">
        <div className="flex flex-col gap-4 p-4">
          <section className="flex flex-col gap-3">
            <SectionTitle>Scenario</SectionTitle>
            {groupedScenarios().map((group) => (
              <div key={group.title} className="flex flex-col gap-1.5">
                <span className="text-muted-foreground">{group.title}</span>
                <div className="flex flex-wrap gap-1.5">
                  {group.scenarios.map((s) => {
                    const active = s.id === scenario.id
                    return (
                      <Button
                        key={s.id}
                        variant={active ? "default" : "outline"}
                        size="xs"
                        aria-pressed={active}
                        disabled={busy}
                        title={s.description}
                        onClick={() => {
                          if (!active) run(() => resetScenario(s.id))
                        }}
                      >
                        {s.label}
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))}
            <p className="rounded-lg bg-muted/60 px-3 py-2 text-muted-foreground">
              {scenario.description}
              <span className="mt-1 block text-foreground/60">
                Changes persist until you reset.
              </span>
            </p>
          </section>

          <Separator />

          <section className="flex flex-col gap-2">
            <SectionTitle>Daemon</SectionTitle>

            <div className="flex flex-col gap-1.5 px-2">
              <span className="font-medium text-foreground">Latency</span>
              <div
                role="radiogroup"
                aria-label="Daemon latency"
                className="grid grid-cols-4 gap-1 rounded-full bg-muted/60 p-1"
              >
                {LATENCY_CHOICES.map((ms) => {
                  const active = faults.daemonLatencyMs === ms
                  return (
                    <button
                      key={ms}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => void setFaults({ daemonLatencyMs: ms })}
                      className={cn(
                        "rounded-full py-1 text-muted-foreground transition-colors hover:text-foreground",
                        active &&
                          "bg-background font-medium text-foreground shadow-sm"
                      )}
                    >
                      {formatLatency(ms)}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="flex flex-col">
              <FaultRow
                id="dev-fault-online"
                label="Daemon online"
                hint="Off: the daemon refuses everything."
                checked={faults.daemonOnline}
                onChange={(checked) =>
                  void setFaults({ daemonOnline: checked })
                }
              />
              <FaultRow
                id="dev-fault-permission"
                label="Deny connect permission"
                hint="Connect fails at the permission step."
                checked={faults.permissionDenied}
                onChange={(checked) =>
                  void setFaults({ permissionDenied: checked })
                }
              />
              <FaultRow
                id="dev-fault-discovery"
                label="Discovery failure"
                hint="Vault discovery fails, so Connect does too."
                checked={faults.discoveryFailure}
                onChange={(checked) =>
                  void setFaults({ discoveryFailure: checked })
                }
              />
              <FaultRow
                id="dev-fault-mutation"
                label="Mutation failure"
                hint="The daemon refuses every change."
                checked={faults.mutationFailure}
                onChange={(checked) =>
                  void setFaults({ mutationFailure: checked })
                }
              />
              <FaultRow
                id="dev-fault-stale"
                label="Stale mutations"
                hint="Changes fail with a stale-revision problem."
                checked={faults.staleResponses}
                onChange={(checked) =>
                  void setFaults({ staleResponses: checked })
                }
              />
            </div>
          </section>
        </div>
      </ScrollArea>
    </aside>
  )
}

export default ScenarioWorkbench
