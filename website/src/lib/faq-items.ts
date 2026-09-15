/**
 * The landing page's FAQ. The rendered list and the FAQPage structured data
 * are both generated from this array; the optional link only renders on the
 * page.
 */
export interface FaqItem {
  question: string
  answer: string
  link?: { href: string; label: string }
}

export const FAQ_ITEMS: FaqItem[] = [
  {
    question: "Does it change my existing bookmarks?",
    answer:
      "It displays and edits the bookmarks you already have, through your browser's built-in bookmark APIs. Nothing is moved, merged or deleted unless you do it yourself in the organizer.",
  },
  {
    question: "Is it free?",
    answer:
      "Yes. Bookmarks But Better is free and open source under the MIT license, and it needs no account. The source code is on GitHub if you prefer to build it yourself.",
  },
  {
    question:
      "Can I import bookmarks from Pocket, Raindrop or another browser?",
    answer:
      "Yes. Import a bookmarks HTML file exported from any browser, or the CSV exports from Raindrop and Pocket. You can export the active source to an HTML file at any time.",
    link: { href: "/docs/start/import-export/", label: "Import and export" },
  },
  {
    question: "Does it work with Obsidian?",
    answer:
      "The optional daemon keeps your bookmarks as plain Markdown files in a folder you choose, with no hidden database. That folder stays usable in a text editor, in Obsidian and in Git.",
    link: {
      href: "/guides/obsidian-bookmarks/",
      label: "Obsidian bookmarks as Markdown files",
    },
  },
  {
    question: "Does it work in Safari?",
    answer:
      "Yes, with differences. Safari gives extensions no access to its bookmarks and no new-tab override, so there the extension works with a Markdown vault served by the local daemon, and you open the dashboard from the toolbar popup. It is not in the Mac App Store yet; for now you build it from the source code.",
    link: { href: "/docs/start/safari/", label: "Safari setup" },
  },
  {
    question: "Where do my bookmarks actually live?",
    answer:
      "In your browser's own bookmarks, or in a folder of Markdown files you choose. The legacy Standalone source, which is retiring, keeps its collection in the browser profile's local storage; moving off it is an explicit copy that leaves that data intact. Nothing is uploaded anywhere.",
    link: { href: "/docs/start/sources/", label: "Bookmark sources" },
  },
  {
    question: "Do you collect anything at all?",
    answer:
      "No accounts, analytics, tracking, ads or bookmark-content collection. The extension contacts only a public favicon service (origins only) and, if you connect one, your own loopback-only daemon.",
    link: { href: "/privacy/", label: "Privacy" },
  },
]
