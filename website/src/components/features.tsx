import { Section } from "@/components/section"

interface Feature {
  title: string
  description: string
  image?: string
  alt?: string
}

const FEATURES: Feature[] = [
  {
    title: "A masonry dashboard for your new tab",
    description:
      "Bookmark folders become cards in a responsive masonry grid. Open a new tab and see your library instead of a search page.",
    image: "/screenshots/01-dashboard.png",
    alt: "The Bookmarks But Better dashboard in dark mode",
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
]

const MINI_FEATURES = [
  {
    title: "Quick capture",
    description:
      "One click from the popup saves the page you are on to your active source.",
  },
  {
    title: "Omnibox search",
    description:
      "Address-bar search across a connected vault — no dashboard required.",
  },
]

const BODY = "text-base/7 text-pretty text-muted-foreground sm:text-sm/6"

function ImageCell({ feature }: { feature: Feature }) {
  return (
    <dl className="h-full overflow-hidden rounded-lg bg-card ring-1 ring-border">
      {feature.image && (
        <img
          src={feature.image}
          alt={feature.alt}
          loading="lazy"
          decoding="async"
          width={1400}
          height={875}
          className="block w-full object-cover object-top outline -outline-offset-1 outline-black/5 dark:outline-white/10"
        />
      )}
      <div className="p-5">
        <dt className="font-display text-lg font-medium tracking-tight">
          {feature.title}
        </dt>
        <dd className={`mt-2 ${BODY}`}>{feature.description}</dd>
      </div>
    </dl>
  )
}

function TextCell({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <dl className="flex h-full flex-col justify-center gap-2 rounded-lg bg-muted/40 p-6 ring-1 ring-border">
      <dt className="font-display text-lg font-medium tracking-tight">
        {title}
      </dt>
      <dd className={BODY}>{description}</dd>
    </dl>
  )
}

export function Features() {
  return (
    <Section
      index="01"
      title="Everything a bookmark keeper wants"
      id="features"
    >
      <div className="grid gap-4 md:grid-cols-6">
        <div className="md:col-span-4">
          <ImageCell feature={FEATURES[0]} />
        </div>
        <div className="md:col-span-2">
          <TextCell
            title={MINI_FEATURES[0].title}
            description={MINI_FEATURES[0].description}
          />
        </div>
        <div className="md:col-span-2">
          <TextCell
            title={MINI_FEATURES[1].title}
            description={MINI_FEATURES[1].description}
          />
        </div>
        <div className="md:col-span-4">
          <ImageCell feature={FEATURES[1]} />
        </div>
        <div className="md:col-span-2">
          <ImageCell feature={FEATURES[2]} />
        </div>
        <div className="md:col-span-2">
          <ImageCell feature={FEATURES[3]} />
        </div>
        <div className="md:col-span-2">
          <ImageCell feature={FEATURES[4]} />
        </div>
      </div>
    </Section>
  )
}
