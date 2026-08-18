import { Section } from "@/components/section"
import { CopyButton } from "@/components/copy-button"

const COMMANDS = [
  {
    label: "macOS / Linux",
    code: "curl -fsSL https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.sh | bash",
  },
  {
    label: "Windows (PowerShell)",
    code: "irm https://github.com/farhadeidi/bookmarks-but-better/releases/latest/download/install.ps1 | iex",
  },
  {
    label: "Any platform with Node.js",
    code: "npx bookmarks-but-better@latest",
  },
]

const BULLETS = [
  "Bookmarks are plain Markdown files — readable, diffable, backed up by any file sync",
  "The daemon binds to 127.0.0.1 only; it makes no outbound request",
  "Host several vaults in one daemon and switch between them per browser profile",
  "Save the active tab from the popup, or search the vault from the address bar",
]

export function DaemonCta() {
  return (
    <Section index="03" title="Your bookmarks, as plain Markdown" id="daemon">
      <div className="grid items-start gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="leading-relaxed text-pretty text-muted-foreground">
            An optional local daemon turns a folder of Markdown files into a
            bookmark source. It is the same dashboard — backed by files you own
            on disk, on every machine you keep in sync.
          </p>
          <ul className="mt-6 space-y-3">
            {BULLETS.map((bullet) => (
              <li
                key={bullet}
                className="flex items-start gap-3 text-sm text-muted-foreground"
              >
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                {bullet}
              </li>
            ))}
          </ul>
          <a
            href="/daemon/"
            className="mt-8 inline-flex h-11 items-center rounded-md border border-border bg-card px-5 text-sm font-medium transition-colors hover:bg-muted"
          >
            Full install guide
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              className="ml-2 size-4"
              aria-hidden
            >
              <path d="M5 12h14m-6-6 6 6-6 6" />
            </svg>
          </a>
        </div>
        <div className="min-w-0 space-y-4">
          {COMMANDS.map((command) => (
            <div
              key={command.label}
              className="rounded-lg border border-border bg-card"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {command.label}
                </span>
                <CopyButton
                  text={command.code}
                  label={`${command.label} command`}
                />
              </div>
              <pre className="overflow-x-auto p-4 text-xs leading-relaxed">
                <code>{command.code}</code>
              </pre>
            </div>
          ))}
          <p className="text-xs text-muted-foreground">
            All three install the same release artifact, checksum-verified.
            Entirely optional — the extension works without it.
          </p>
        </div>
      </div>
    </Section>
  )
}
