import { HugeiconsIcon } from "@hugeicons/react"
import { BrowserIcon, ComputerTerminal01Icon } from "@hugeicons/core-free-icons"
import { cn } from "@/lib/utils"

export type OnboardingSourceChoice = "browser" | "daemon"

interface SourceStepProps {
  value: OnboardingSourceChoice
  onChange: (choice: OnboardingSourceChoice) => void
}

/**
 * Where bookmarks will live for a brand-new profile: the Browser Source, or a
 * Daemon Source.
 *
 * The wizard only reaches this step where both of those exist, so both options
 * are unconditional here — a platform that offers one source skips the step
 * rather than asking a question with a single answer.
 *
 * The Standalone Source is deliberately absent: it is in its sunset period and
 * cannot be selected by new users.
 */
export function SourceStep({ value, onChange }: SourceStepProps) {
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
            vault, shared across browsers and profiles on this machine. Requires
            installing the daemon.
          </span>
        </button>
      </div>
    </div>
  )
}
