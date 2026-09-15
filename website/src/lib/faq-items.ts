/**
 * The landing page's FAQ. The rendered list and the FAQPage structured data
 * are both generated from this array.
 */
export interface FaqItem {
  question: string
  answer: string
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
  },
  {
    question: "Does it work with Obsidian?",
    answer:
      "The optional daemon keeps your bookmarks as plain Markdown files in a folder you choose, with no hidden database. That folder stays usable in a text editor, in Obsidian and in Git.",
  },
  {
    question: "What about Safari?",
    answer:
      "Safari does not give extensions access to its bookmarks and has no new-tab override. On Safari the extension works with a Markdown vault served by the local daemon, and you open the dashboard from the toolbar popup.",
  },
  {
    question: "Where do my bookmarks actually live?",
    answer:
      "In your browser's own bookmarks (Browser source), or in a folder of Markdown files you choose (vault daemon). The legacy Standalone source keeps its collection in the browser profile's local storage. Nothing is uploaded anywhere.",
  },
  {
    question: "What happens to the Standalone source?",
    answer:
      "It is retiring over one major version. Migration to a vault is an explicit copy that leaves your legacy data intact — nothing happens automatically.",
  },
  {
    question: "Do you collect anything at all?",
    answer:
      "No accounts, analytics, tracking, ads or bookmark-content collection. The extension contacts only a public favicon service (origins only) and, if you connect one, your own loopback-only daemon.",
  },
]
