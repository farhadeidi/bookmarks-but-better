import { DaemonConnectionPanel } from "@/features/settings/daemon-connection-panel"
import { platformCapabilities } from "@/sources/platform"
import { useSourceStore } from "@/stores/source-store"
import { StepHeading } from "./step-heading"

/**
 * Connecting a vault, in two situations told apart by capability rather than
 * by browser name.
 *
 * Where a Browser Source exists, the vault is an addition the user asked for
 * and can skip. Where it does not — Safari, whose WebExtensions implementation
 * has no bookmarks API — a vault is the only way into the dashboard, so the
 * copy says that plainly.
 *
 * Once a connection exists the form gives way to a confirmation: connecting
 * persists through the source store and switches to the vault, so there is
 * nothing left for the wizard itself to write.
 */
export function DaemonSetupStep({
  browserOff = false,
}: {
  /** The user switched Browser bookmarks off, pending a vault to replace it. */
  browserOff?: boolean
} = {}) {
  const daemonOnly = !platformCapabilities().browserSource
  const connections = useSourceStore((s) => s.config.connections)
  const sources = useSourceStore((s) => s.config.sources)

  const origins = Object.keys(connections)
  const vaultCount = Object.values(sources).filter(
    (entry) => entry?.origin !== undefined
  ).length

  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        title="Connect your vault"
        description={
          daemonOnly
            ? "This browser does not share its own bookmarks with extensions, so a vault is where your bookmarks will live. Keep it in a synced folder like iCloud Drive to see the same bookmarks on every machine."
            : browserOff
              ? "Once connected, the dashboard shows only the vault. Your browser bookmarks stay untouched — turn them back on any time in Settings → Sources."
              : "Your browser bookmarks stay as they are. Once connected, the dashboard opens on the vault — switch back any time from the top of the page."
        }
      />

      {origins.length > 0 ? (
        <div
          role="status"
          className="flex items-center gap-3 rounded-xl p-4 ring-1 ring-border/60"
        >
          <span
            aria-hidden
            className="size-2 shrink-0 rounded-full bg-emerald-500"
          />
          <div className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Connected</span>
            <span className="truncate text-xs text-muted-foreground">
              {origins.join(", ")} · {vaultCount}{" "}
              {vaultCount === 1 ? "Vault" : "Vaults"}
            </span>
          </div>
        </div>
      ) : (
        <>
          <DaemonConnectionPanel firstConnection />
          <p className="text-xs text-muted-foreground">
            {daemonOnly
              ? "The dashboard stays empty until a vault is connected; you can also connect one later in Settings → Sources."
              : browserOff
                ? "Not ready yet? Skip for now and keep Browser bookmarks until a vault is connected — connect one any time in Settings → Sources."
                : "Not ready yet? Skip for now and start on Browser bookmarks — connect a vault any time in Settings → Sources."}
          </p>
        </>
      )}
    </div>
  )
}
