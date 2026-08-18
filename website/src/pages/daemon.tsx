import { ArticlePage } from "@/components/article-page"
import { CopyButton } from "@/components/copy-button"
import { SITE } from "@/lib/site"

function CodeBlock({ label, code }: { label: string; code: string }) {
  return (
    <div className="rounded-lg bg-card ring-1 ring-border">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="text-sm font-medium tracking-wide text-muted-foreground">
          {label}
        </span>
        <CopyButton text={code} label={`${label} command`} />
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-6">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function H2({ title }: { title: string }) {
  return (
    <h2 className="font-display text-xl font-medium tracking-tight text-balance">
      {title}
    </h2>
  )
}

const BODY = "text-base/7 text-pretty text-muted-foreground sm:text-sm/6"
const CODE = "rounded bg-muted px-1.5 py-0.5"

export function Daemon() {
  return (
    <ArticlePage
      title="The vault daemon"
      intro="A small, optional background process that serves your bookmarks from a folder of Markdown files. It binds to localhost only, and it is the doorway to using Bookmarks But Better in Safari."
    >
      <section className="space-y-3">
        <H2 title="Why a daemon?" />
        <p className={BODY}>
          Browsers keep bookmarks in an internal database you cannot easily
          read, sync as files, or edit with your own tools. The daemon flips
          that: your bookmarks are plain Markdown files in a folder you choose,
          and the daemon serves them to the extension over{" "}
          <code className={CODE}>127.0.0.1</code>. Any file sync becomes a
          bookmark sync — no account required.
        </p>
        <p className={BODY}>
          On Safari, which does not expose browser bookmarks to extensions at
          all, the daemon is the only source — so it is how the dashboard ships
          there.
        </p>
      </section>

      <section className="space-y-4">
        <H2 title="Install" />
        <CodeBlock
          label="macOS / Linux"
          code={`curl -fsSL ${SITE.installSh} | bash`}
        />
        <CodeBlock
          label="Windows (PowerShell)"
          code={`irm ${SITE.installPs1} | iex`}
        />
        <CodeBlock
          label="Any platform with Node.js"
          code="npx bookmarks-but-better@latest"
        />
        <p className={BODY}>
          All three install the same release artifact, verified against its
          published SHA-256 checksum, into a user-local directory — no{" "}
          <code className={CODE}>sudo</code>, nothing system-wide. Pipe into{" "}
          <code className={CODE}>bash</code>, not{" "}
          <code className={CODE}>sh</code>. The installer finishes by running{" "}
          <code className={CODE}>setup</code>, which asks where your vault
          should live and which port to serve.
        </p>
      </section>

      <section className="space-y-3">
        <H2 title="Connect the extension" />
        <ol className="list-decimal space-y-2 pl-5 text-base/7 text-pretty text-muted-foreground sm:text-sm/6">
          <li>Open the extension's Settings → Sources.</li>
          <li>
            Enter the daemon's address —{" "}
            <code className={CODE}>127.0.0.1:52222</code> by default — and click
            Connect.
          </li>
          <li>
            Every vault the daemon hosts appears as its own source: enable,
            label and switch between them freely.
          </li>
        </ol>
        <p className={BODY}>
          The extension requests permission to reach loopback addresses at that
          moment — never at install time — and only records the connection if a
          real health check succeeds. An unreachable daemon is reported as an
          error, never a silent fallback.
        </p>
      </section>

      <section className="space-y-4">
        <H2 title="Several vaults, one daemon" />
        <CodeBlock
          label="Terminal"
          code={`bookmarks-but-better serve \\
  --vault reading=~/vaults/reading \\
  --vault archive=~/vaults/archive`}
        />
        <p className={BODY}>
          Each vault id is a unique slug with its own directory; they must not
          overlap. Every vault is a separate source in the extension, with its
          own tree, search and events under{" "}
          <code className={CODE}>/api/v1/vaults/&#123;id&#125;/…</code>.
        </p>
      </section>

      <section className="space-y-3">
        <H2 title="Uninstall" />
        <p className={BODY}>
          Delete the install directory and the{" "}
          <code className={CODE}>bookmarks-but-better</code> symlink. Your vault
          is a directory of Markdown files the installer has never heard of — it
          stays exactly where you put it.
        </p>
        <p className={BODY}>
          The complete guide — release pinning, the HTTP API, background
          services — lives in{" "}
          <a
            href={SITE.daemonDocs}
            className="text-foreground underline decoration-border underline-offset-4 hover:text-primary"
          >
            docs/DAEMON.md
          </a>
          .
        </p>
      </section>
    </ArticlePage>
  )
}
