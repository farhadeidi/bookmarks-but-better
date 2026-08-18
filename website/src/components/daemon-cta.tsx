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

const CHECK = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="2"
    className="mt-0.5 size-4 shrink-0 stroke-primary"
    aria-hidden
  >
    <path d="m20 6-11 11-5-5" />
  </svg>
)

const ARROW = (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    strokeWidth="1.8"
    className="size-4 shrink-0 stroke-current"
    aria-hidden
  >
    <path d="M5 12h14m-6-6 6 6-6 6" />
  </svg>
)

export function DaemonCta() {
  return (
    <Section index="03" title="Your bookmarks, as plain Markdown" id="daemon">
      <div className="grid items-start gap-10 lg:grid-cols-2">
        <div className="min-w-0">
          <p className="text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
            An optional local daemon turns a folder of Markdown files into a
            bookmark source. It is the same dashboard — backed by files you own
            on disk, on every machine you keep in sync.
          </p>
          <ul role="list" className="mt-6 space-y-3">
            {BULLETS.map((bullet) => (
              <li
                key={bullet}
                className="flex items-start gap-3 text-base/7 text-pretty text-muted-foreground sm:text-sm/6"
              >
                {CHECK}
                {bullet}
              </li>
            ))}
          </ul>
          <a
            href="/daemon/"
            className="mt-8 inline-flex h-11 items-center gap-2 rounded-md border border-border bg-card pr-4 pl-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Full install guide
            {ARROW}
          </a>
        </div>
        <div className="min-w-0 space-y-4">
          {COMMANDS.map((command) => (
            <div
              key={command.label}
              className="rounded-lg bg-card ring-1 ring-border"
            >
              <div className="flex items-center justify-between border-b border-border px-4 py-2">
                <span className="text-sm font-medium tracking-wide text-muted-foreground">
                  {command.label}
                </span>
                <CopyButton
                  text={command.code}
                  label={`${command.label} command`}
                />
              </div>
              <pre className="overflow-x-auto p-4 text-xs leading-6">
                <code>{command.code}</code>
              </pre>
            </div>
          ))}
          <p className="text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
            All three install the same release artifact, checksum-verified.
            Entirely optional — the extension works without it.
          </p>
        </div>
      </div>
    </Section>
  )
}
