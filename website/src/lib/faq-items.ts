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
    question: "Is it really free?",
    answer:
      "Yes. It is open source under the MIT license, with no paid tier, no upsell and no account. The source code is on GitHub if you prefer to build it yourself.",
  },
  {
    question: "What about Safari?",
    answer:
      "Safari does not expose browser bookmarks to extensions, so on Safari the dashboard runs on the Markdown vault daemon instead — your bookmarks live as plain files on disk.",
  },
  {
    question: "Where do my bookmarks actually live?",
    answer:
      "In your browser profile (Browser source), in the profile's local storage (Standalone source), or in a folder of Markdown files you choose (vault daemon). They are never uploaded anywhere.",
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
