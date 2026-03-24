export function DoneStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8 text-center">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-bold tracking-tight">You're all set!</h2>
        <p className="text-muted-foreground">
          Your new tab is ready. You can always change these in settings.
        </p>
      </div>
    </div>
  )
}
