/**
 * The Dev Workbench runtime: the coordinator that owns which scenario is
 * active, applies its deterministic seed into the profile's real stores, and
 * hands out engines for the simulated sources.
 *
 * The invariant that makes scenario selection trustworthy: the profile's
 * Source Configuration is only ever correct for one (scenario, revision)
 * pair, recorded as a stamp in the preferences database. Anything else — a
 * first run, a scenario change, a reset, an external wipe — is detected at
 * bootstrap and reseeded. A reload never resurrects a stale world.
 */

import { setPlatformCapabilities } from "@/sources/platform"
import { saveSourceConfig } from "@/sources/persistence"
import { setOnboardingCompleted } from "@/browser/onboarding-preference"
import { normalizeSourceConfig } from "@/sources/config"
import type { BookmarkNode } from "@/browser"
import { MutableBookmarkEngine, type EngineFlavor } from "./engine"
import {
  DEFAULT_FAULTS,
  clearSourceData,
  delay,
  readAppliedStamp,
  readRuntime,
  sealSourceEpoch,
  writeAppliedStamp,
  writeRuntime,
  type DevFaultControls,
  type DevRuntimeSnapshot,
} from "./state"
import {
  DEFAULT_SCENARIO_ID,
  getScenario,
  initialConfigFor,
  isScenarioId,
  type DevScenario,
} from "./scenarios"

export interface DevRuntime {
  state: DevRuntimeSnapshot
  engines: Map<string, MutableBookmarkEngine>
}

const SCENARIO_PARAM = "scenario"
const DEV_SCENARIO_SEED_VERSION = 1

let runtime: DevRuntime | null = null
let bootstrapInFlight: Promise<DevRuntime> | null = null
const listeners = new Set<() => void>()

const FALLBACK_SNAPSHOT: DevRuntimeSnapshot = {
  scenarioId: DEFAULT_SCENARIO_ID,
  faults: DEFAULT_FAULTS,
  revision: 0,
}

function notify(): void {
  for (const listener of listeners) listener()
}

export function subscribeRuntime(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The current snapshot for `useSyncExternalStore`; stable between changes. */
export function runtimeSnapshot(): DevRuntimeSnapshot {
  return runtime?.state ?? FALLBACK_SNAPSHOT
}

export function currentScenario(): DevScenario {
  return getScenario(runtimeSnapshot().scenarioId)
}

export function currentFaults(): DevFaultControls {
  return runtimeSnapshot().faults
}

function faultsFor(scenarioId: string): DevFaultControls {
  return {
    ...DEFAULT_FAULTS,
    ...getScenario(scenarioId).faults,
  }
}

function scenarioFromLocation(): string | null {
  try {
    const param = new URLSearchParams(window.location.search).get(
      SCENARIO_PARAM
    )
    return param && isScenarioId(param) ? param : null
  } catch {
    return null
  }
}

/** The URL that deterministically addresses one scenario. */
export function scenarioUrl(scenarioId: string): string {
  return `/?${SCENARIO_PARAM}=${encodeURIComponent(scenarioId)}`
}

async function applyScenarioSeed(
  scenario: DevScenario,
  state: DevRuntimeSnapshot
): Promise<void> {
  // The order is the contract: seal the old world's writes first (an
  // in-flight engine persist must not land after the wipe below), wipe the
  // simulated data, then write the profile's Source Configuration and
  // onboarding flag, then stamp. A crash before the stamp simply re-runs
  // the whole seed — it is idempotent.
  sealSourceEpoch()
  await clearSourceData()
  await saveSourceConfig(
    normalizeSourceConfig(initialConfigFor(scenario), scenario.capabilities)
  )
  await setOnboardingCompleted(scenario.onboardingCompleted)
  await writeAppliedStamp({
    scenarioId: state.scenarioId,
    revision: state.revision,
    seedVersion: DEV_SCENARIO_SEED_VERSION,
  })
}

/**
 * Bootstraps the dev world before the source store initializes: resolves the
 * scenario (URL wins over the persisted one), reseeds when the stamp says
 * the profile is not in this scenario at this revision, and installs the
 * scenario's capabilities as the platform's answer.
 */
export function ensureDevRuntime(): Promise<DevRuntime> {
  bootstrapInFlight ??= bootstrap()
  return bootstrapInFlight
}

async function bootstrap(): Promise<DevRuntime> {
  const urlScenario = scenarioFromLocation()
  const persisted = await readRuntime()

  let state: DevRuntimeSnapshot
  if (!persisted) {
    state = {
      scenarioId: urlScenario ?? DEFAULT_SCENARIO_ID,
      faults: faultsFor(urlScenario ?? DEFAULT_SCENARIO_ID),
      revision: 1,
    }
    await writeRuntime(state)
  } else if (urlScenario && urlScenario !== persisted.scenarioId) {
    // URL navigation is an explicit scenario change: the new scenario starts
    // from its seed with its default failure controls.
    state = {
      scenarioId: urlScenario,
      faults: faultsFor(urlScenario),
      revision: persisted.revision + 1,
    }
    await clearSourceData()
    await writeRuntime(state)
  } else {
    state = persisted
  }

  const scenario = getScenario(state.scenarioId)
  const stamp = await readAppliedStamp()
  if (
    !stamp ||
    stamp.scenarioId !== state.scenarioId ||
    stamp.revision !== state.revision ||
    stamp.seedVersion !== DEV_SCENARIO_SEED_VERSION
  ) {
    await applyScenarioSeed(scenario, state)
  }

  setPlatformCapabilities(scenario.capabilities)

  runtime = { state, engines: new Map() }
  return runtime
}

/**
 * Updates a failure control. The in-memory world updates first — the very
 * next application operation sees it — and persistence is best-effort
 * behind it, so an IndexedDB hiccup can never freeze a toggle mid-effect.
 */
export async function setFaults(
  partial: Partial<DevFaultControls>
): Promise<void> {
  const current = runtime ?? (await ensureDevRuntime())
  const state: DevRuntimeSnapshot = {
    ...current.state,
    faults: { ...current.state.faults, ...partial },
  }
  current.state = state
  notify()
  await writeRuntime(state)
}

/**
 * Reset (or switch) to a scenario, deterministically: the revision is
 * bumped, the old world's in-flight engine writes are sealed, every
 * simulated source and the profile's Source Configuration are reseeded,
 * and the page reloads into the scenario's URL — the one path that
 * guarantees no stale session survives.
 */
export async function resetScenario(scenarioId?: string): Promise<void> {
  const current = runtime ?? (await ensureDevRuntime())
  const target = scenarioId ?? current.state.scenarioId
  const state: DevRuntimeSnapshot = {
    scenarioId: target,
    faults: faultsFor(target),
    revision: current.state.revision + 1,
  }
  await applyScenarioSeed(getScenario(target), state)
  await writeRuntime(state)
  window.location.assign(scenarioUrl(target))
}

/** The engine for one simulated source, created once per page and reused. */
export async function engineFor(
  sourceKey: string,
  flavor: EngineFlavor,
  seed: () => BookmarkNode
): Promise<MutableBookmarkEngine> {
  const current = runtime ?? (await ensureDevRuntime())
  let engine = current.engines.get(sourceKey)
  if (!engine) {
    engine = new MutableBookmarkEngine({ sourceKey, flavor, seed })
    current.engines.set(sourceKey, engine)
  }
  return engine
}

export { delay }

/**
 * Test seam: forget the bootstrapped world so the next `ensureDevRuntime`
 * bootstraps from persisted state again. Development code never calls this;
 * `resetScenario` reloads the page instead.
 */
export function resetDevRuntime(): void {
  runtime = null
  bootstrapInFlight = null
  setPlatformCapabilities(null)
}
