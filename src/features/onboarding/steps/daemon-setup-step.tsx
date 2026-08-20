import { DaemonConnectionPanel } from "@/features/settings/daemon-connection-panel"
import { platformCapabilities } from "@/sources/platform"

function RepositoryLink() {
  return (
    <a
      href="https://github.com/farhadeidi/bookmarks-but-better"
      target="_blank"
      rel="noopener noreferrer"
      className="underline underline-offset-2 hover:text-foreground"
    >
      project repository
    </a>
  )
}

/**
 * Two situations, told apart by capability rather than by browser name.
 *
 * Where a Browser Source exists, the daemon is a choice the user just made and
 * can undo later. Where it does not — Safari, whose WebExtensions
 * implementation has no bookmarks API — a daemon Vault is the only way into
 * the dashboard, so the copy says that plainly instead of offering "connect
 * later from Settings" as if it were an equivalent option.
 */
export function DaemonSetupStep() {
  const daemonOnly = !platformCapabilities().browserSource

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Set up the daemon</h2>
        {daemonOnly ? (
          <p className="text-muted-foreground">
            This browser does not share its own bookmarks with extensions — they
            are never read or changed here — so a daemon Vault is where your
            bookmarks will live. The daemon is a separate program that runs on
            this machine; see the <RepositoryLink /> for install instructions,
            then connect below. Keeping the vault in a synced folder such as
            iCloud Drive gives you the same bookmarks on every machine you use.
          </p>
        ) : (
          <p className="text-muted-foreground">
            The daemon is a separate program that runs on this machine and keeps
            your bookmark vault. If you haven't installed it yet, see the{" "}
            <RepositoryLink /> for install instructions, then come back and
            connect below. You can also skip this and connect later from
            Settings.
          </p>
        )}
      </div>

      <DaemonConnectionPanel />
    </div>
  )
}
