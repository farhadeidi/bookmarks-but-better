import { HugeiconsIcon } from "@hugeicons/react"
import { BrowserIcon, ComputerTerminal01Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { platformCapabilities } from "@/sources/platform"

export type OnboardingSourceChoice = "browser" | "daemon"

interface ModeStepProps {
  value: OnboardingSourceChoice
  onChange: (choice: OnboardingSourceChoice) => void
}

/**
 * Where bookmarks will live for a brand-new profile: the Browser Source, or a
 * Daemon Source.
 *
 * The Standalone Source is deliberately absent: it is in its sunset period
 * and cannot be selected by new users. On a platform without the bookmarks
 * API (Safari), only the daemon is offered — the capability seam decides,
 * not a browser name.
 */
export function ModeStep({ value, onChange }: ModeStepProps) {
  const caps = platformCapabilities()

  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">
          Where do your bookmarks live?
        </h2>
        <p className="text-muted-foreground">
          You can always change this later in settings.
        </p>
      </div>

      <div
        className={cn(
          "grid grid-cols-1 gap-3",
          caps.browserSource && "sm:grid-cols-2"
        )}
      >
        {caps.browserSource && (
          <button
            type="button"
            onClick={() => onChange("browser")}
            className={cn(
              "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
              value === "browser"
                ? "border-primary bg-accent ring-2 ring-primary"
                : "border-border hover:bg-accent/50"
            )}
          >
            <HugeiconsIcon
              icon={BrowserIcon}
              size={22}
              className="text-primary"
            />
            <span className="font-medium">Browser</span>
            <span className="text-xs text-muted-foreground">
              Uses the bookmarks already in this browser and stays in sync with
              it. No extra install.
            </span>
          </button>
        )}

        {caps.daemonSource && (
          <button
            type="button"
            onClick={() => onChange("daemon")}
            className={cn(
              "flex flex-col items-start gap-2 rounded-lg border p-4 text-left transition-colors",
              value === "daemon"
                ? "border-primary bg-accent ring-2 ring-primary"
                : "border-border hover:bg-accent/50"
            )}
          >
            <HugeiconsIcon
              icon={ComputerTerminal01Icon}
              size={22}
              className="text-primary"
            />
            <span className="font-medium">Daemon</span>
            <span className="text-xs text-muted-foreground">
              Bookmarks live in a local <code>bookmarks-but-better</code> daemon
              vault, shared across browsers and profiles on this machine.
              Requires installing the daemon.
            </span>
          </button>
        )}
      </div>

      {!caps.browserSource && (
        <p className="text-center text-xs text-muted-foreground">
          This browser does not expose its bookmarks to extensions, so a daemon
          is the only source here.
        </p>
      )}
    </div>
  )
}
