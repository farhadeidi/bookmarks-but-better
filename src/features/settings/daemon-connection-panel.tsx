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
 * Both scripts resolve the latest stable release, which carries daemon builds
 * since 4.0.0. Without `--vault` they install the binary and print the next
 * steps, which the paragraph below names. See docs/DAEMON.md.
 */
const INSTALL_COMMANDS: Record<Platform, string> = {
  macos:
    "curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash",
  linux:
    "curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash",
  windows:
    "irm https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1 | iex",
}

const PLATFORM_LABEL: Record<Platform, string> = {
  macos: "macOS",
  linux: "Linux",
  windows: "Windows",
}

/**
 * The Daemon Manager: one command that installs the daemon, asks where the
 * first vault lives and starts the service — and, run again, reports status
 * and adds vaults. See packages/bookmarks-but-better.
 */
const MANAGER_COMMAND = "npx bookmarks-but-better@latest"

const MANAGER_DESCRIPTION =
  "It installs the daemon, asks where your vault should live and starts it. Run it again any time for status, updates and more vaults."

/** A quiet text toggle, so secondary options don't read as actions. */
const TEXT_TOGGLE_CLASS =
  "h-auto w-fit px-0 text-xs text-muted-foreground hover:text-foreground hover:no-underline"

/** A command to paste into a terminal, with a copy button beside it. */
function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = React.useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // No clipboard access here: the command stays selectable by hand.
    }
  }

  return (
    <div className="flex items-center gap-2 rounded-lg bg-muted/60 py-1.5 pr-1.5 pl-3 ring-1 ring-border/60">
      <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-pre">
        <span aria-hidden className="text-muted-foreground select-none">
          ${" "}
        </span>
        {command}
      </code>
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={`Copy ${command}`}
        onClick={() => void copy()}
      >
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  )
}

/**
 * The Daemon Manager first, because it is the whole setup in one command; the
 * raw install scripts are the fallback for a machine without Node.js.
 *
 * `standalone` introduces itself; inside a numbered step the step does that.
 */
function InstallGuide({ standalone = false }: { standalone?: boolean }) {
  const [showScripts, setShowScripts] = React.useState(false)
  const [platform, setPlatform] = React.useState<Platform>(() =>
    guessPlatform()
  )

  return (
    <div className="flex flex-col gap-2">
      {standalone && (
        <span className="text-xs font-medium">
          No daemon yet? Run this in a terminal:
        </span>
      )}
      <CommandLine command={MANAGER_COMMAND} />
      {standalone && (
        <p className="text-xs text-muted-foreground">{MANAGER_DESCRIPTION}</p>
      )}
      <Button
        type="button"
        variant="link"
        size="xs"
        className={TEXT_TOGGLE_CLASS}
        onClick={() => setShowScripts((v) => !v)}
      >
        {showScripts
          ? "Hide install scripts"
          : "No Node.js? Use an install script"}
      </Button>
      {showScripts && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            {(["macos", "linux", "windows"] as const).map((p) => (
              <Button
                key={p}
                type="button"
                variant={platform === p ? "secondary" : "ghost"}
                size="xs"
                onClick={() => setPlatform(p)}
              >
                {PLATFORM_LABEL[p]}
              </Button>
            ))}
          </div>
          <CommandLine command={INSTALL_COMMANDS[platform]} />
          <p className="text-xs text-muted-foreground">
            Add <code>--vault &lt;path&gt;</code> to set up the vault in the
            same step.
          </p>
        </div>
      )}
    </div>
  )
}

/** One numbered step of a first connection. */
function SetupStep({
  number,
  title,
  description,
  children,
}: {
  number: number
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{title}</span>
          <span className="text-xs text-muted-foreground">{description}</span>
        </div>
        {children}
      </div>
    </li>
  )
}

/**
 * Connecting a daemon: validate, permission, health-check, discover — then
 * the source store persists the connection and switches to its first Vault,
 * live, with no reload.
 *
 * For a profile's first connection it reads as two numbered steps — start the
 * daemon, then connect — since that is when someone is most likely not to have
 * a daemon yet. Otherwise the install guide waits under Advanced with the
 * bearer token.
 */
export function DaemonConnectionPanel({
  firstConnection = false,
  onConnected,
}: {
  firstConnection?: boolean
  onConnected?: (origin: string) => void
} = {}) {
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
      onConnected?.(result.origin)
      return
    }
    setPhase("error")
    setError({ stage: result.stage, message: result.message })
  }, [origin, bearerToken, connectDaemon, onConnected])

  const connectForm = (
    <div className="flex flex-col gap-2">
      {!firstConnection && (
        <Label className="text-sm font-medium" htmlFor="daemon-address">
          Daemon address
        </Label>
      )}
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
          disabled={phase === "connecting" || origin.trim() === ""}
          title={
            origin.trim() === "" ? "Enter the daemon address first." : undefined
          }
          onClick={handleConnect}
        >
          {phase === "connecting" ? "Connecting…" : error ? "Retry" : "Connect"}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error.message}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Loopback only (127.0.0.1 or localhost). Nothing leaves this machine, and
        nothing is requested until you click Connect.
      </p>
      <Button
        type="button"
        variant="link"
        size="xs"
        className={TEXT_TOGGLE_CLASS}
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? "Hide advanced" : "Advanced"}
      </Button>
      {showAdvanced && (
        <div className="flex flex-col gap-3 pt-1">
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
          {!firstConnection && <InstallGuide standalone />}
        </div>
      )}
    </div>
  )

  if (!firstConnection) return connectForm

  return (
    <ol className="flex flex-col gap-6">
      <SetupStep
        number={1}
        title="Start the daemon"
        description={`Run this in a terminal. ${MANAGER_DESCRIPTION}`}
      >
        <InstallGuide />
      </SetupStep>
      <SetupStep
        number={2}
        title="Connect to it"
        description="Each Vault the daemon hosts becomes its own source."
      >
        {connectForm}
      </SetupStep>
    </ol>
  )
}
