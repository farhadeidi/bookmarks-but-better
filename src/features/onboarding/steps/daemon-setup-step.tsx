import { DaemonConnectionPanel } from "@/features/settings/daemon-connection-panel"

export function DaemonSetupStep() {
  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Set up the daemon</h2>
        <p className="text-muted-foreground">
          The daemon is a separate program that runs on this machine and keeps
          your bookmark vault. If you haven't installed it yet, see the{" "}
          <a
            href="https://github.com/farhadeidi/bookmarks-but-better"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            project repository
          </a>{" "}
          for install instructions, then come back and connect below. You can
          also skip this and connect later from Settings.
        </p>
      </div>

      <DaemonConnectionPanel />
    </div>
  )
}
