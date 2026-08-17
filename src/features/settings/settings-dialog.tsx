import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useUIStore } from "@/stores/ui-store"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useSourceStore } from "@/stores/source-store"
import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryId,
} from "./settings-categories"
import { GeneralPanel } from "./panels/settings-panels"
import { AppearancePanel } from "./panels/settings-panels"
import { DataMigrationPanel } from "./panels/settings-panels"
import { AdvancedPanel } from "./panels/settings-panels"
import { AboutPanel } from "./panels/settings-panels"
import { SourcesPanel } from "./panels/sources-panel"
import { StandaloneMigrationDialog } from "@/features/standalone-sunset"

/**
 * The categorized settings experience: vertical category tabs on wide
 * screens, a compact horizontal selector on narrow ones. Every setting the
 * product has lives in exactly one category; none was dropped in the move
 * from the single-scroll dialog.
 */
export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)
  const wide = useMediaQuery("(min-width: 640px)")

  const [category, setCategory] = React.useState<SettingsCategoryId>("general")
  const [migrationOpen, setMigrationOpen] = React.useState(false)

  const standaloneLegacy = useSourceStore(
    (s) => s.config.sources["standalone"]?.legacy === true
  )

  const active = SETTINGS_CATEGORIES.find((c) => c.id === category)

  const onOpenChange = (next: boolean) => {
    if (!next) closeSettings()
  }

  return (
    <>
      {standaloneLegacy && (
        <StandaloneMigrationDialog
          open={migrationOpen}
          onOpenChange={setMigrationOpen}
        />
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="grid h-[calc(100svh-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-card p-0 text-card-foreground shadow-xl ring-border sm:h-[min(46rem,calc(100svh-3rem))] sm:max-w-2xl md:max-w-3xl dark:shadow-none">
          <DialogHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>{active?.description}</DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)] sm:grid-rows-1">
            {wide ? (
              <nav
                aria-label="Settings categories"
                className="flex min-h-0 flex-col gap-1 overflow-y-auto border-r border-border/60 bg-muted/30 p-3"
              >
                {SETTINGS_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={c.id === category}
                    onClick={() => setCategory(c.id)}
                    className={cn(
                      "rounded-md px-3 py-2 text-left text-sm font-medium",
                      c.id === category
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </nav>
            ) : (
              <nav
                aria-label="Settings categories"
                className="no-scrollbar flex min-w-0 gap-1 overflow-x-auto border-b border-border/60 bg-muted/30 p-2"
              >
                {SETTINGS_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={c.id === category}
                    onClick={() => setCategory(c.id)}
                    className={cn(
                      "shrink-0 rounded-md px-3 py-2 text-sm font-medium",
                      c.id === category
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </nav>
            )}

            <div className="min-h-0 min-w-0 overflow-y-auto bg-background/35 p-5 sm:p-6">
              {category === "general" && <GeneralPanel />}
              {category === "sources" && (
                <SourcesPanel
                  onMigrateStandalone={() => setMigrationOpen(true)}
                />
              )}
              {category === "appearance" && <AppearancePanel />}
              {category === "data-migration" && (
                <DataMigrationPanel
                  onMigrateStandalone={() => setMigrationOpen(true)}
                  showStandaloneMigration={standaloneLegacy}
                />
              )}
              {category === "advanced" && <AdvancedPanel />}
              {category === "about" && <AboutPanel />}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
