import { RootFolderSelect } from "@/features/root-folder-select"

interface RootFolderStepProps {
  value: string | null
  onChange: (id: string | null) => void
}

export function RootFolderStep({ value, onChange }: RootFolderStepProps) {
  return (
    <div className="flex flex-col gap-6 py-4">
      <div className="flex flex-col gap-2 text-center">
        <h2 className="text-2xl font-bold tracking-tight">Choose your bookmark folder</h2>
        <p className="text-muted-foreground">
          Pick a folder to display on your new tab page. You can change this later in settings.
        </p>
      </div>
      <RootFolderSelect value={value} onChange={onChange} />
    </div>
  )
}
