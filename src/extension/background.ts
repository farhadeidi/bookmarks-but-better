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
