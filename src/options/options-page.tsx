import * as React from "react"
import { useAppBootstrap } from "@/hooks/use-app-bootstrap"
import {
  SETTINGS_CATEGORIES,
  SettingsBody,
  type SettingsCategoryId,
} from "@/features/settings"

/**
 * The extension's options page: the same Settings the new tab shows in a
 * dialog, as a page of its own. The browser opens it from its extension
 * management page, which is what makes Settings reachable when the new tab
 * cannot be used at all.
 */
export function OptionsPage() {
  useAppBootstrap({ offerOnboarding: false })
  const [category, setCategory] = React.useState<SettingsCategoryId>("sources")
  const active = SETTINGS_CATEGORIES.find((c) => c.id === category)

  return (
    <div className="min-h-svh bg-background text-foreground">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">{active?.description}</p>
        </header>
        <div className="overflow-hidden rounded-xl bg-card text-card-foreground shadow-xl ring-1 ring-border/60 dark:shadow-none">
          <SettingsBody category={category} onCategoryChange={setCategory} />
        </div>
      </main>
    </div>
  )
}
