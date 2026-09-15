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
    image: "/screenshots/dashboard.png",
    alt: "The Bookmarks But Better dashboard in dark mode",
  },
  {
    title: "A real organizer",
    description:
      "Drag bookmarks between folders, reorder, rename, create and delete — in a full tree editor, not a nested settings page. Import HTML from any browser or CSV from Raindrop and Pocket.",
    image: "/screenshots/organizer.png",
    alt: "The Bookmark Organizer tree editor with folders expanded",
  },
  {
    title: "Your sources, your root",
    description:
      "Switch between browser bookmarks and Markdown vaults from the header, and start the dashboard from any folder.",
    image: "/screenshots/sources.png",
    alt: "The source menu listing browser bookmarks and two vaults",
  },
  {
    title: "Find it in a keystroke",
    description:
      "Search every bookmark in the active source by title or URL, then open it or reveal it in the organizer.",
    image: "/screenshots/search.png",
    alt: "The search palette showing results for “git”",
  },
  {
    title: "Ten themes, light to cyberpunk",
    description:
      "Ten color themes with light, dark and system modes — pick per taste, not per trend.",
    image: "/screenshots/themes.png",
    alt: "The dashboard in six color themes, light and dark",
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
      "Type “bb” in the address bar to search your active source — browser bookmarks or a vault, no dashboard required.",
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
