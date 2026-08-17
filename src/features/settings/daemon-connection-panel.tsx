import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useSourceStore } from "@/stores/source-store"
import { DEFAULT_DAEMON_ORIGIN } from "@/browser/daemon"
import type { DaemonConnectStage } from "@/browser/daemon"

type Phase = "idle" | "connecting" | "error"

interface AttemptError {
  stage: DaemonConnectStage
  message: string
}

type Platform = "macos" | "linux" | "windows"

function guessPlatform(): Platform {
  const platform = navigator.platform ?? ""
  const ua = navigator.userAgent ?? ""
  if (/Mac/i.test(platform) || /Macintosh/i.test(ua)) return "macos"
  if (/Win/i.test(platform) || /Windows/i.test(ua)) return "windows"
  return "linux"
}

/**
 * `| bash`, not `| sh`: `install.sh` is a bash script (`set -o pipefail` alone
 * makes it one) and `/bin/sh` is dash on Debian and Ubuntu, where piping it to
 * `sh` dies on line 1 with `set: Illegal option -o pipefail` — before the
 * script can say anything useful about what went wrong.
 *
 * No flag selects the prerelease here even though the daemon only exists as
 * one: both scripts resolve the latest stable release, notice it carries no
 * daemon build, and fall back to the newest prerelease that does — so this
 * plain command keeps working unchanged the day a stable release ships the
 * daemon. See docs/DAEMON.md.
 */
const INSTALL_COMMANDS: Record<Platform, string> = {
  macos: "curl -fsSL https://bookmarks-but-better.dev/install.sh | bash",
  linux: "curl -fsSL https://bookmarks-but-better.dev/install.sh | bash",
  windows: "irm https://bookmarks-but-better.dev/install.ps1 | iex",
}

const PLATFORM_LABEL: Record<Platform, string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
}

function InstallGuide() {
  const [platform, setPlatform] = React.useState<Platform>(() =>
    guessPlatform()
  )

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Don't have the daemon installed yet?
        </span>
        <div className="flex gap-1">
          {(["macos", "linux", "windows"] as const).map((p) => (
            <Button
              key={p}
              type="button"
              variant={platform === p ? "default" : "outline"}
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={() => setPlatform(p)}
            >
              {PLATFORM_LABEL[p]}
            </Button>
          ))}
        </div>
      </div>
      <code className="overflow-x-auto rounded bg-muted px-2 py-1.5 text-xs whitespace-pre">
        {INSTALL_COMMANDS[platform]}
      </code>
      <p className="text-xs text-muted-foreground">
        The daemon is still in beta: there is no stable release of it yet, so
        this installs the latest prerelease.
      </p>
      <p className="text-xs text-muted-foreground">
        Then run <code>bookmarks-but-better setup</code> to create a vault and{" "}
        <code>bookmarks-but-better service install --vault &lt;path&gt;</code>{" "}
        to run it in the background. The extension connects over loopback only —
        nothing here ever leaves this machine.
      </p>
    </div>
  )
}

/**
 * Connecting a daemon: validate, permission, health-check, discover — then
 * the source store persists the connection and switches to its first Vault,
 * live, with no reload.
 */
export function DaemonConnectionPanel() {
  const connectDaemon = useSourceStore((s) => s.connectDaemon)

  const [origin, setOrigin] = React.useState(DEFAULT_DAEMON_ORIGIN)
  const [bearerToken, setBearerToken] = React.useState("")
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [error, setError] = React.useState<AttemptError | null>(null)
  const [showAdvanced, setShowAdvanced] = React.useState(false)

  const handleConnect = React.useCallback(async () => {
    setPhase("connecting")
    setError(null)
    const result = await connectDaemon(origin, {
      bearerToken: bearerToken || undefined,
    })
    if (result.ok) {
      // The source store has already switched, live.
      setPhase("idle")
      return
    }
    setPhase("error")
    setError({ stage: result.stage, message: result.message })
  }, [origin, bearerToken, connectDaemon])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label className="text-sm font-medium" htmlFor="daemon-address">
          Daemon address
        </Label>
        <div className="flex gap-2">
          <Input
            id="daemon-address"
            value={origin}
            onChange={(e) => setOrigin(e.target.value)}
            placeholder={DEFAULT_DAEMON_ORIGIN}
            aria-label="Daemon address"
            disabled={phase === "connecting"}
          />
          <Button
            type="button"
            size="sm"
            disabled={phase === "connecting" || origin.trim() === ""}
            title={
              origin.trim() === ""
                ? "Enter the daemon address first."
                : undefined
            }
            onClick={handleConnect}
          >
            {phase === "connecting"
              ? "Connecting…"
              : error
                ? "Retry"
                : "Connect"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Connects to a local <code>bookmarks-but-better</code> daemon over
          loopback (127.0.0.1 or localhost). Nothing is requested from the
          daemon, and no browser permission is asked for, until you click
          Connect. Every Vault it hosts becomes its own source; an unreachable
          daemon is reported as an error — it never falls back to another
          source.
        </p>
        {error && (
          <p className="text-xs text-destructive" role="alert">
            {error.message}
          </p>
        )}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="w-fit px-0 text-xs text-muted-foreground"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide advanced" : "Advanced"}
      </Button>

      {showAdvanced && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label className="text-sm font-medium" htmlFor="daemon-token">
              Bearer token (optional)
            </Label>
            <Input
              id="daemon-token"
              type="password"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              placeholder="Not required unless the daemon asks for one"
              aria-label="Daemon bearer token"
              disabled={phase === "connecting"}
            />
            <p className="text-xs text-muted-foreground">
              There is no pairing flow yet, so this is normally left blank. One
              token authenticates the whole connection — every Vault it hosts.
            </p>
          </div>
          <InstallGuide />
        </div>
      )}
    </div>
  )
}
