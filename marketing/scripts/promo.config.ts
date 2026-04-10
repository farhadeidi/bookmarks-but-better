/**
 * Promo tile copy config — edit this file to update marketing text.
 * Name + description are pulled dynamically from public/manifest.json.
 */
export const PROMO_CONFIG = {
  tagline: 'NEW TAB EXTENSION',
  headlineMain: 'Bookmarks,',
  headlineSub: 'but better.',
  subtitleSmall: 'A beautiful new tab dashboard for your bookmarks.',
  subtitleMarquee: 'Your bookmarks, beautifully organized.\nA stunning new tab experience.',
  features: [
    'Masonry Layout',
    'Inline Editing',
    'View Modes',
    '100% Private',
  ],
  themingLabel: 'Multiple theming options',
  /** One accent color per theme (same order as the themes array in preferences-store). */
  themeColors: [
    '#6b7280', // default
    '#f59e0b', // amber-minimal
    '#ec4899', // bubblegum
    '#92400e', // caffeine
    '#f97316', // claude
    '#8b5cf6', // claymorphism
    '#e879f9', // cyberpunk
    '#fb923c', // solar-dusk
    '#f43f5e', // t3-chat
    '#d97706', // vintage-paper
  ],
}
