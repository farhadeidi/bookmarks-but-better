export function WelcomeStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8 text-center">
      <img src="/logo.svg" alt="Bookmarks But Better" className="h-20 w-20 dark:hidden" />
      <img src="/logo-dark.svg" alt="Bookmarks But Better" className="hidden h-20 w-20 dark:block" />
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">Bookmarks — But Better</h2>
        <p className="text-muted-foreground">Your bookmarks, beautifully organized.</p>
      </div>
    </div>
  )
}
