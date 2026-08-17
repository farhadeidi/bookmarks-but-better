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
import { BookmarksPanel } from "./panels/settings-panels"
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
        <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-2xl md:max-w-3xl">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>{active?.description}</DialogDescription>
          </DialogHeader>

          <div className="flex max-h-[calc(85vh-5rem)] min-h-0 flex-col sm:flex-row">
            {wide ? (
              <nav
                aria-label="Settings categories"
                className="flex w-44 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3"
              >
                {SETTINGS_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={c.id === category}
                    onClick={() => setCategory(c.id)}
                    className={cn(
                      "rounded-md px-3 py-2 text-left text-sm transition-colors",
                      c.id === category
                        ? "bg-accent font-medium text-foreground"
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
                className="no-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b p-2"
              >
                {SETTINGS_CATEGORIES.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    role="tab"
                    aria-selected={c.id === category}
                    onClick={() => setCategory(c.id)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-xs transition-colors",
                      c.id === category
                        ? "border-primary bg-accent font-medium text-foreground"
                        : "border-border/60 text-muted-foreground"
                    )}
                  >
                    {c.label}
                  </button>
                ))}
              </nav>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {category === "general" && <GeneralPanel />}
              {category === "sources" && (
                <SourcesPanel
                  onMigrateStandalone={() => setMigrationOpen(true)}
                />
              )}
              {category === "appearance" && <AppearancePanel />}
              {category === "bookmarks" && <BookmarksPanel />}
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
