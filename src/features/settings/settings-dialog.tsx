import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useUIStore } from "@/stores/ui-store"
import {
  SETTINGS_CATEGORIES,
  type SettingsCategoryId,
} from "./settings-categories"
import { SettingsBody } from "./settings-body"

/**
 * Settings as the new tab shows it: `SettingsBody` inside a dialog whose
 * header names the selected category. The options page frames the same body
 * as a page.
 */
export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen)
  const closeSettings = useUIStore((s) => s.closeSettings)

  const [category, setCategory] = React.useState<SettingsCategoryId>("sources")
  const active = SETTINGS_CATEGORIES.find((c) => c.id === category)

  const onOpenChange = (next: boolean) => {
    if (!next) closeSettings()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[calc(100svh-1rem)] grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden bg-card p-0 text-card-foreground shadow-xl ring-border sm:h-[min(46rem,calc(100svh-3rem))] sm:max-w-2xl md:max-w-3xl dark:shadow-none">
        <DialogHeader className="border-b border-border/60 px-5 py-4 sm:px-6">
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>{active?.description}</DialogDescription>
        </DialogHeader>
        <SettingsBody category={category} onCategoryChange={setCategory} />
      </DialogContent>
    </Dialog>
  )
}
