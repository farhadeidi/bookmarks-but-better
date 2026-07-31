import * as React from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { usePreferencesStore } from "@/stores/preferences-store"
import {
  DEFAULT_DAEMON_ORIGIN,
  connectToDaemon,
  disconnectDaemon,
  forgetDaemon,
  type DaemonConnectStage,
} from "@/browser/daemon"
import { getDaemonConnectionConfig } from "@/browser/adapter-preference"

type Phase = "idle" | "connecting" | "error"

interface AttemptError {
  stage: DaemonConnectStage
  message: string
}

/**
 * Where Disconnect/Forget should switch to: `"browser"` inside an actual
 * browser-extension context (bookmarks and storage are right there),
 * `"standalone"` everywhere else — the same choice `detectAdapter` itself
 * falls back to when nothing else applies.
 */
function fallbackMode(): "browser" | "standalone" {
  try {
    return typeof chrome !== "undefined" &&
      typeof chrome.bookmarks !== "undefined"
      ? "browser"
      : "standalone"
  } catch {
    return "standalone"
  }
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
        Then run <code>bbb setup</code> to create a vault and{" "}
        <code>bbb service install --vault &lt;path&gt;</code> to run it in the
        background. The extension connects over loopback only — nothing here
        ever leaves this machine.
      </p>
    </div>
  )
}

export function DaemonConnectionPanel() {
  const adapterMode = usePreferencesStore((s) => s.adapterMode)
  const isActive = adapterMode === "daemon"

  const [origin, setOrigin] = React.useState(DEFAULT_DAEMON_ORIGIN)
  const [bearerToken, setBearerToken] = React.useState("")
  const [savedOrigin, setSavedOrigin] = React.useState<string | null>(null)
  const [phase, setPhase] = React.useState<Phase>("idle")
  const [error, setError] = React.useState<AttemptError | null>(null)
  const [showAdvanced, setShowAdvanced] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    getDaemonConnectionConfig().then((config) => {
      if (cancelled || !config) return
      setSavedOrigin(config.origin)
      setOrigin(config.origin)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const handleConnect = React.useCallback(async () => {
    setPhase("connecting")
    setError(null)
    const result = await connectToDaemon(origin, {
      bearerToken: bearerToken || undefined,
    })
    if (result.ok) {
      // The app bootstrapped its adapter once, at page load, so switching the
      // active source needs a fresh load rather than a live adapter swap.
      window.location.reload()
      return
    }
    setPhase("error")
    setError({ stage: result.stage, message: result.message })
  }, [origin, bearerToken])

  const handleDisconnect = React.useCallback(async () => {
    await disconnectDaemon(fallbackMode())
    window.location.reload()
  }, [])

  const handleForget = React.useCallback(async () => {
    await forgetDaemon(fallbackMode())
    setSavedOrigin(null)
    window.location.reload()
  }, [])

  return (
    <div className="flex flex-col gap-3">
      {isActive ? (
        <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
            <span className="text-sm font-medium">
              Connected to {savedOrigin ?? origin}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={phase === "connecting"}
              onClick={handleConnect}
            >
              {phase === "connecting" ? "Checking…" : "Retry"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDisconnect}
            >
              Disconnect
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleForget}
            >
              Forget
            </Button>
          </div>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error.message}
            </p>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Label className="text-sm font-medium">Daemon Address</Label>
          <div className="flex gap-2">
            <Input
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
            Connects to a local <code>bbb</code> daemon over loopback (127.0.0.1
            or localhost). Nothing is requested from the daemon, and no browser
            permission is asked for, until you click Connect. An unreachable
            daemon is reported as an error here — it never falls back to browser
            bookmarks.
          </p>
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error.message}
            </p>
          )}
          {savedOrigin && (
            <p className="text-xs text-muted-foreground">
              Previously connected to {savedOrigin}.
            </p>
          )}
        </div>
      )}

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
            <Label className="text-sm font-medium">
              Bearer token (optional)
            </Label>
            <Input
              type="password"
              value={bearerToken}
              onChange={(e) => setBearerToken(e.target.value)}
              placeholder="Not required unless the daemon asks for one"
              aria-label="Daemon bearer token"
              disabled={phase === "connecting"}
            />
            <p className="text-xs text-muted-foreground">
              There is no pairing flow yet, so this is normally left blank.
            </p>
          </div>
          <InstallGuide />
        </div>
      )}
    </div>
  )
}
