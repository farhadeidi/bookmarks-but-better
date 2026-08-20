import { platformCapabilities } from "@/sources/platform"
import { createBrowserOmniboxFacade, registerOmniboxListeners } from "./omnibox"

// MV3 workers can be stopped between any two events. Listener registration is
// therefore synchronous, while every event re-reads the Active Source from
// persistence and owns only the request it is currently handling.
//
// The omnibox is a capability, not a given: Safari's WebExtensions
// implementation has none, so its background worker simply registers nothing
// rather than branching inside the listener code.
if (platformCapabilities().omnibox) {
  registerOmniboxListeners(createBrowserOmniboxFacade())
}

/**
 * Show the dashboard once, on a build that does not replace the new tab page.
 *
 * Where it does, an install needs nothing from here: the next new tab *is* the
 * dashboard, and the setup wizard runs there. Where it does not — Safari — a
 * fresh install otherwise ends in silence. Nothing opens, nothing explains
 * that a daemon is required, and the extension looks broken rather than
 * unconfigured.
 *
 * Only on `install`. An update or a browser restart must not steal a tab from
 * someone already set up.
 */
if (
  platformCapabilities().isExtension &&
  !platformCapabilities().newTabOverride
) {
  chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason !== "install") return
    void chrome.tabs.create({ url: chrome.runtime.getURL("index.html") })
  })
}
