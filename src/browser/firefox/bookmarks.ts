import { ChromeBookmarkAdapter } from "../chrome/bookmarks"

/**
 * Firefox bookmark adapter. Identical to Chrome's adapter — both use the
 * `chrome.bookmarks.*` WebExtension API — except `openInManager` is a no-op
 * because Firefox has no equivalent to `chrome://bookmarks/`.
 * The UI hides the "open in manager" button via `capabilities.openInManager`.
 */
export class FirefoxBookmarkAdapter extends ChromeBookmarkAdapter {
  async openInManager(): Promise<void> {
    // intentional no-op — Firefox has no bookmarks manager deep-link
  }
}
