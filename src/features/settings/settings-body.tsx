import * as React from "react"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"
import { useSourceStore } from "@/stores/source-store"
import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryId,
} from "./settings-categories"
import { GeneralPanel } from "./panels/settings-panels"
import { AppearancePanel } from "./panels/appearance-panel"
import { DataMigrationPanel } from "./panels/settings-panels"
import { AdvancedPanel } from "./panels/settings-panels"
import { AboutPanel } from "./panels/settings-panels"
import { SourcesPanel } from "./panels/sources-panel"
import { StandaloneMigrationDialog } from "@/features/standalone-sunset"

/**
 * The categorized settings: vertical category tabs on wide screens, a
 * compact horizontal selector on narrow ones, and the selected panel beside
 * them. The new tab's dialog and the extension's options page both draw this
 * — one set of panels, two frames. Every setting the product has lives in
 * exactly one category.
 */
export function SettingsBody({
  category,
  onCategoryChange,
}: {
  category: SettingsCategoryId
  onCategoryChange: (category: SettingsCategoryId) => void
}) {
  const wide = useMediaQuery("(min-width: 640px)")
  const [migrationOpen, setMigrationOpen] = React.useState(false)

  const standaloneLegacy = useSourceStore(
    (s) => s.config.sources["standalone"]?.legacy === true
  )

  return (
    <>
      {standaloneLegacy && (
        <StandaloneMigrationDialog
          open={migrationOpen}
          onOpenChange={setMigrationOpen}
        />
      )}
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
                onClick={() => onCategoryChange(c.id)}
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
                onClick={() => onCategoryChange(c.id)}
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
            <SourcesPanel onMigrateStandalone={() => setMigrationOpen(true)} />
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
    </>
  )
}
