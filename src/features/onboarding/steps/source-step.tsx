import { HugeiconsIcon } from "@hugeicons/react"
import { BrowserIcon, ComputerTerminal01Icon } from "@hugeicons/core-free-icons"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { StepHeading } from "./step-heading"

interface SourceStepProps {
  useBrowser: boolean
  onUseBrowserChange: (on: boolean) => void
  addVault: boolean
  onAddVaultChange: (on: boolean) => void
}

function SourceOption({
  id,
  icon,
  title,
  description,
  checked,
  onCheckedChange,
}: {
  id: string
  icon: typeof BrowserIcon
  title: string
  description: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-xl p-4 ring-1 transition-colors",
        checked
          ? "bg-primary/5 ring-primary/60"
          : "ring-border/60 hover:bg-muted/40"
      )}
    >
      <HugeiconsIcon
        icon={icon}
        size={20}
        className="mt-0.5 shrink-0 text-primary"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span id={`${id}-title`} className="text-sm font-medium">
          {title}
        </span>
        <span
          id={`${id}-description`}
          className="text-xs text-muted-foreground"
        >
          {description}
        </span>
      </div>
      {/* Named by the title alone; the wrapping label would otherwise make the
          whole card, description included, the switch's name. */}
      <Switch
        id={id}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
        className="mt-0.5"
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </label>
  )
}

/**
 * Where a brand-new profile gets its bookmarks from: the Browser Source, a
 * daemon Vault, or both.
 *
 * Neither is the "real" one. Sources are never merged, but a profile can have
 * both enabled and switch between them, so each is a switch and at least one
 * stays on. The wizard owns that rule and what the switches lead to: the vault
 * puts the connection step on the track, and turning the browser off only
 * takes effect once a vault is connected to take its place.
 *
 * The wizard only reaches this step where both sources exist. The Standalone
 * Source is deliberately absent: it is in its sunset period and cannot be
 * selected by new users.
 */
export function SourceStep({
  useBrowser,
  onUseBrowserChange,
  addVault,
  onAddVaultChange,
}: SourceStepProps) {
  return (
    <div className="flex flex-col gap-6">
      <StepHeading
        title="Your bookmarks"
        description="Choose where the dashboard gets bookmarks from. Use one or both."
      />

      <div className="flex flex-col gap-3">
        <SourceOption
          id="onboarding-use-browser"
          icon={BrowserIcon}
          title="Browser bookmarks"
          description="The bookmarks already in this browser, kept in sync both ways."
          checked={useBrowser}
          onCheckedChange={onUseBrowserChange}
        />
        <SourceOption
          id="onboarding-add-vault"
          icon={ComputerTerminal01Icon}
          title="Local vault"
          description="Bookmarks kept in a folder on this machine by the Bookmarks But Better daemon, shared across browsers and profiles."
          checked={addVault}
          onCheckedChange={onAddVaultChange}
        />

        <p className="text-xs text-muted-foreground">
          Keep at least one on. With both, switch between them from the top of
          the dashboard.
        </p>
      </div>
    </div>
  )
}
