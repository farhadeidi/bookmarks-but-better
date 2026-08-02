import { createBrowserOmniboxFacade, registerOmniboxListeners } from "./omnibox"

// MV3 workers can be stopped between any two events. Listener registration is
// therefore synchronous, while every event reconstructs its daemon client
// state from persistence and owns only the request it is currently handling.
registerOmniboxListeners(createBrowserOmniboxFacade())
