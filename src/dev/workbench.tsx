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
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { DEV_SCENARIOS, DEFAULT_SCENARIO_ID } from "@/dev/scenarios"
import {
  resetScenario,
  runtimeSnapshot,
  setFaults,
  subscribeRuntime,
} from "@/dev/runtime"
import { LATENCY_CHOICES } from "@/dev/state"

function useDevRuntime() {
  return React.useSyncExternalStore(
    subscribeRuntime,
    runtimeSnapshot,
    runtimeSnapshot
  )
}

function FaultRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <Label
        className="flex flex-col gap-0.5 text-xs leading-tight font-normal"
        htmlFor={`dev-fault-${label}`}
      >
        <span className="font-medium text-foreground">{label}</span>
        <span className="text-muted-foreground">{hint}</span>
      </Label>
      <Switch
        id={`dev-fault-${label}`}
        aria-label={label}
        size="sm"
        checked={checked}
        onCheckedChange={onChange}
      />
    </div>
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
        className="fixed bottom-6 left-6 z-10 inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/90 px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur-sm transition-colors hover:text-foreground"
      >
        <span aria-hidden className="size-1.5 rounded-full bg-violet-500" />
        Dev Workbench
      </button>
    )
  }

  return (
    <aside
      aria-label="Dev Workbench"
      className="fixed bottom-6 left-6 z-10 flex max-h-[70svh] w-84 flex-col gap-3 overflow-y-auto rounded-2xl border border-border/60 bg-background/95 p-4 text-xs shadow-lg backdrop-blur-sm"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">
          Dev Workbench
        </span>
        <button
          type="button"
          aria-label="Close Dev Workbench"
          onClick={() => setOpen(false)}
          className="rounded-full px-2 text-muted-foreground transition-colors hover:text-foreground"
        >
          ▾
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="font-medium text-foreground">Scenario</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between"
                aria-label="Scenario"
              />
            }
          >
            {scenario.label}
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="max-h-72 overflow-y-auto"
          >
            <DropdownMenuLabel>Switch scenario</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={runtime.scenarioId}
              onValueChange={(value) => run(() => resetScenario(value))}
            >
              {DEV_SCENARIOS.map((s) => (
                <DropdownMenuRadioItem key={s.id} value={s.id}>
                  {s.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <p className="text-muted-foreground">{scenario.description}</p>
        <div className="flex items-center justify-between pt-1">
          <span className="text-muted-foreground">
            Scenario data persists until reset.
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            aria-label="Reset scenario"
            onClick={() => run(() => resetScenario())}
          >
            Reset
          </Button>
        </div>
      </div>

      <Separator />

      <div className="flex flex-col gap-1">
        <span className="font-medium text-foreground">Daemon controls</span>

        <div className="flex items-center justify-between gap-2 py-1">
          <Label
            className="flex flex-col gap-0.5 text-xs leading-tight font-normal"
            htmlFor="dev-fault-latency"
          >
            <span className="font-medium text-foreground">Latency</span>
            <span className="text-muted-foreground">
              Added to every simulated daemon operation.
            </span>
          </Label>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  className="w-20 justify-between"
                  aria-label="Daemon latency"
                />
              }
            >
              {runtime.faults.daemonLatencyMs === 0
                ? "none"
                : `${runtime.faults.daemonLatencyMs}ms`}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={String(runtime.faults.daemonLatencyMs)}
                onValueChange={(value) =>
                  void setFaults({ daemonLatencyMs: Number(value) })
                }
              >
                {LATENCY_CHOICES.map((ms) => (
                  <DropdownMenuRadioItem key={ms} value={String(ms)}>
                    {ms === 0 ? "none" : `${ms}ms`}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <FaultRow
          label="Daemon online"
          hint="Off: the daemon refuses everything — the offline state, end to end."
          checked={runtime.faults.daemonOnline}
          onChange={(checked) => void setFaults({ daemonOnline: checked })}
        />
        <FaultRow
          label="Deny connect permission"
          hint="Connect fails at the permission step."
          checked={runtime.faults.permissionDenied}
          onChange={(checked) => void setFaults({ permissionDenied: checked })}
        />
        <FaultRow
          label="Discovery failure"
          hint="Vault discovery fails; Connect fails at discovery."
          checked={runtime.faults.discoveryFailure}
          onChange={(checked) => void setFaults({ discoveryFailure: checked })}
        />
        <FaultRow
          label="Mutation failure"
          hint="The daemon refuses every change."
          checked={runtime.faults.mutationFailure}
          onChange={(checked) => void setFaults({ mutationFailure: checked })}
        />
        <FaultRow
          label="Stale mutations"
          hint="Changes are rejected with a stale-revision problem."
          checked={runtime.faults.staleResponses}
          onChange={(checked) => void setFaults({ staleResponses: checked })}
        />
      </div>
    </aside>
  )
}

export default ScenarioWorkbench
