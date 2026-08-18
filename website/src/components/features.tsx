import { Section } from "@/components/section"

interface Feature {
  title: string
  description: string
  image?: string
  alt?: string
  wide?: boolean
}

const FEATURES: Feature[] = [
  {
    title: "A masonry dashboard for your new tab",
    description:
      "Bookmark folders become cards in a responsive masonry grid. Open a new tab and see your library instead of a search page.",
    image: "/screenshots/01-dashboard.png",
    alt: "The Bookmarks But Better dashboard in dark mode",
    wide: true,
  },
  {
    title: "A real organizer",
    description:
      "Drag bookmarks between folders, reorder, rename, create and delete — in a full tree editor, not a nested settings page.",
    image: "/screenshots/02-organizer.png",
    alt: "The Bookmark Organizer tree editor",
  },
  {
    title: "Edit everything inline",
    description:
      "Rename a bookmark, change its URL, or retitle a folder without leaving the dashboard.",
    image: "/screenshots/05-inline-edit.png",
    alt: "Inline editing of a bookmark title",
  },
  {
    title: "Ten themes, light to cyberpunk",
    description:
      "Ten color themes with light, dark and system modes — pick per taste, not per trend.",
    image: "/screenshots/03-themes.png",
    alt: "The theme picker showing all ten color themes",
  },
  {
    title: "Your rules, your root",
    description:
      "Choose any folder as the dashboard root, switch list and icon views per folder, and import or export standard bookmark HTML.",
    image: "/screenshots/04-settings.png",
    alt: "The settings dialog",
  },
  {
    title: "Capture and search without leaving your flow",
    description:
      "Save the active tab from the extension popup, and — with a vault daemon — search every bookmark straight from the address bar: type bookmarks-but-better, press Tab, go.",
  },
]

export function Features() {
  return (
    <Section
      index="01"
      title="Everything a bookmark keeper wants"
      id="features"
    >
      <div className="grid gap-4 md:grid-cols-2">
        {FEATURES.map((feature) => (
          <article
            key={feature.title}
            className={
              feature.wide
                ? "group overflow-hidden rounded-lg border border-border bg-card md:col-span-2"
                : "group overflow-hidden rounded-lg border border-border bg-card"
            }
          >
            {feature.image ? (
              <img
                src={feature.image}
                alt={feature.alt}
                loading="lazy"
                className="w-full border-b border-border object-cover object-top transition-transform duration-500 group-hover:scale-[1.01]"
              />
            ) : (
              <div className="flex h-full min-h-40 flex-col justify-center gap-3 border-b border-border bg-muted/40 p-6">
                <p className="font-display text-sm text-muted-foreground italic">
                  Quick capture
                </p>
                <p className="text-sm text-muted-foreground">
                  One click from the popup saves the page you are on to your
                  active source.
                </p>
                <p className="font-display text-sm text-muted-foreground italic">
                  Omnibox search
                </p>
                <p className="text-sm text-muted-foreground">
                  Address-bar search across a connected vault — no dashboard
                  required.
                </p>
              </div>
            )}
            <div className="p-5">
              <h3 className="font-display text-lg font-medium tracking-tight">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {feature.description}
              </p>
            </div>
          </article>
        ))}
      </div>
    </Section>
  )
}
