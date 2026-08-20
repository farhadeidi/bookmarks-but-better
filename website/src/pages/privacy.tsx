import { ArticlePage } from "@/components/article-page"
import { SITE } from "@/lib/site"

const BODY = "text-base/7 text-pretty text-muted-foreground sm:text-sm/6"
const CODE = "rounded bg-muted px-1.5 py-0.5"

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section>
      <h2 className="font-display text-xl font-medium tracking-tight text-balance">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

export function Privacy() {
  return (
    <ArticlePage
      title="Privacy"
      intro="Bookmarks But Better is built for people who do not want their reading habits collected. This page describes, in plain language, what the extension and this website touch."
    >
      <Section title="What we never collect">
        <p className={BODY}>
          No accounts, no analytics, no tracking, no advertising, and no
          collection of bookmark content. There is no server that receives your
          bookmarks, and there is nothing to opt out of.
        </p>
      </Section>

      <Section title="Where your data lives">
        <p className={BODY}>
          <strong className="text-foreground">Browser source:</strong> bookmarks
          stay in your browser's own bookmark store and are read or changed only
          through its built-in APIs.
        </p>
        <p className={BODY}>
          <strong className="text-foreground">Standalone source:</strong> the
          legacy collection lives in your browser profile's local storage and
          never leaves it. It is retiring over one major version; migration to a
          vault is an explicit copy.
        </p>
        <p className={BODY}>
          <strong className="text-foreground">Vault daemon:</strong> bookmarks
          are Markdown files in a folder you choose on your own disk. The daemon
          serves them to the extension over{" "}
          <code className={CODE}>127.0.0.1</code> /{" "}
          <code className={CODE}>localhost</code> only. Nothing is uploaded.
        </p>
      </Section>

      <Section title="Network requests the extension makes">
        <p className={BODY}>
          One kind only, by default: favicon lookups against Google's public
          favicon service. Bookmark origins (the scheme and host) are sent to
          find site icons; full URL paths are not.
        </p>
        <p className={BODY}>
          Icons are looked up in this order, and each step that answers stops
          the next from running: a local cache of icon bytes stored on your
          machine, then the browser's own on-device icon store (Chrome's favicon
          API — Firefox has no equivalent an extension may read), then Google,
          then a letter placeholder drawn locally. A successful lookup is cached
          for 30 days, so a given site is normally asked about once a month
          rather than on every new tab, and cached icons keep working offline.
        </p>
        <p className={BODY}>
          If you connect a local daemon, the extension talks to that loopback
          address — permission is requested at connect time, never at install
          time.
        </p>
      </Section>

      <Section title="This website">
        <p className={BODY}>
          This site is static HTML, CSS and JavaScript served from GitHub Pages.
          It embeds no analytics, sets no cookies, and loads no third-party
          scripts. The live preview uses seeded demo bookmarks and the same
          public favicon service as the extension to show real site icons. Only
          fixed demo origins are requested; no user bookmarks are used. Your
          dark-mode preference is stored in your browser's{" "}
          <code className={CODE}>localStorage</code> and nowhere else.
        </p>
      </Section>

      <Section title="Permissions, briefly">
        <p className={BODY}>
          <strong className="text-foreground">Chrome:</strong> bookmarks,
          storage, activeTab, favicon and clipboardWrite.
        </p>
        <p className={BODY}>
          <strong className="text-foreground">Firefox:</strong> bookmarks,
          storage and activeTab.
        </p>
        <p className={BODY}>
          <strong className="text-foreground">Safari:</strong> activeTab,
          storage and tabs. Safari uses the local daemon source because browser
          bookmarks are not available to extensions there.
        </p>
        <p className={BODY}>
          Optional localhost permissions appear only when you connect a daemon.
        </p>
      </Section>

      <Section title="Questions">
        <p className={BODY}>
          The source code is public — audit it at{" "}
          <a
            href={SITE.repository}
            className="text-foreground underline decoration-border underline-offset-4 hover:text-primary"
          >
            {SITE.repository.replace("https://", "")}
          </a>
          , and open an issue there if anything here looks wrong.
        </p>
      </Section>
    </ArticlePage>
  )
}
