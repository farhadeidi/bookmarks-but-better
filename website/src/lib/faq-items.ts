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
    question: "Do I have to set anything up?",
    answer:
      "No. Install it, open a new tab, and the bookmarks you already have are there as folder cards. The first run offers to walk you through the options, and you can skip straight past it.",
    link: { href: "/docs/start/install/", label: "Install the extension" },
  },
  {
    question: "Do I need the Markdown vault or the daemon?",
    answer:
      "No. The dashboard runs on your browser's own bookmarks with nothing installed beyond the extension, and most people leave it that way. Set up a vault only if you want your bookmarks as files you can open in a text editor, keep in Git or read in Obsidian. Safari is the exception: it gives extensions no access to its bookmarks, so a vault is the only source there.",
    link: { href: "/docs/daemon/", label: "How Markdown vaults work" },
  },
  {
    question: "Does it change my existing bookmarks?",
    answer:
      "It displays and edits the bookmarks you already have, through your browser's built-in bookmark APIs. Nothing is moved, merged or deleted unless you do it yourself in the organizer.",
  },
  {
    question: "Is it free?",
    answer:
      "Yes, all of it. Bookmarks But Better is free and open source under the MIT license, and it needs no account. The source code is on GitHub if you prefer to build it yourself.",
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
      href: "/docs/guides/obsidian-bookmarks/",
      label: "Obsidian bookmarks as Markdown files",
    },
  },
  {
    question: "Does it work in Safari?",
    answer:
      "The Safari version is coming soon. If you need it now, you can build it yourself from the source code. It works differently: Safari gives extensions no access to its bookmarks and no new-tab override, so there the extension works with a Markdown vault served by the local daemon, and you open the dashboard from the toolbar popup.",
    link: {
      href: "/docs/start/safari/",
      label: "Safari: status and building from source",
    },
  },
  {
    question: "Where do my bookmarks actually live?",
    answer:
      "In your browser's own bookmarks, or in a folder of Markdown files you choose. The legacy Standalone source, which is retiring, keeps its collection in a database inside the browser profile (IndexedDB); moving off it is an explicit copy that leaves that data intact. Nothing is uploaded anywhere.",
    link: { href: "/docs/start/sources/", label: "Bookmark sources" },
  },
  {
    question: "Do you collect anything at all?",
    answer:
      "No accounts, analytics, tracking, ads or bookmark-content collection. The extension contacts only a public favicon service (origins only) and, if you connect one, your own loopback-only daemon.",
    link: { href: "/privacy/", label: "Privacy" },
  },
]
