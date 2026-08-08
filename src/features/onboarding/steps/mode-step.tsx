import { HugeiconsIcon } from "@hugeicons/react"
import { BrowserIcon, ComputerTerminal01Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"
import { isDaemonModeSupported } from "@/browser/daemon"
import type { AdapterMode } from "@/browser/types"

interface ModeStepProps {
  value: AdapterMode
  onChange: (mode: AdapterMode) => void
}

export function ModeStep({ value, onChange }: ModeStepProps) {
  const daemonSupported = isDaemonModeSupported()

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

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

        {daemonSupported && (
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

      <button
        type="button"
        onClick={() => onChange("standalone")}
        className={cn(
          "text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline",
          value === "standalone" && "font-medium text-foreground underline"
        )}
      >
        Advanced: use a standalone collection stored in this browser only
      </button>
    </div>
  )
}
