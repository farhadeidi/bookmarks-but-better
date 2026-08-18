import { Section } from "@/components/section"
import { DEMO_THEMES, PICK_THEME_EVENT } from "@/lib/themes"

export function ThemesGallery() {
  function pick(id: string) {
    window.dispatchEvent(new CustomEvent(PICK_THEME_EVENT, { detail: id }))
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches
      ? "auto"
      : "smooth"
    document.getElementById("demo")?.scrollIntoView({ behavior })
  }

  return (
    <Section index="04" title="Ten themes, one calm dashboard" id="themes">
      <p className="max-w-2xl text-pretty text-muted-foreground">
        Every theme ships with light, dark and system modes. Tap one to preview
        it on the live dashboard above — or{" "}
        <a
          href="/preview/"
          className="text-foreground underline decoration-border underline-offset-4 hover:text-primary"
        >
          open the full-screen preview
        </a>{" "}
        and change it in the app's real settings.
      </p>
      <ul
        role="list"
        className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-5"
      >
        {DEMO_THEMES.map((theme) => (
          <li key={theme.id}>
            <button
              type="button"
              onClick={() => pick(theme.id)}
              className="group w-full overflow-hidden rounded-lg bg-card text-left ring-1 ring-border focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span
                className="block h-16 w-full transition-transform duration-300 group-hover:scale-105"
                style={{
                  background: `linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent}cc 55%, ${theme.accent}55 100%)`,
                }}
                aria-hidden
              />
              <span className="block px-3 py-2.5 text-sm font-medium">
                {theme.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Section>
  )
}
