/**
 * Dark mode, shared by the marketing pages and the Starlight docs.
 *
 * `bbb-site-theme` ("dark" | "light", absent = follow the system) is the
 * canonical preference. Starlight's own `starlight-theme` key is written
 * alongside it and read as a fallback, so a visitor's choice holds on both
 * halves of the site. The site styles key off the `.dark` class; Starlight
 * keys off `data-theme` — the script sets both.
 */
export const SITE_THEME_KEY = "bbb-site-theme"
export const STARLIGHT_THEME_KEY = "starlight-theme"

/** Inlined in <head> before first paint, so there is no flash. */
export const THEME_INIT_SCRIPT = `(function(){var t=null;try{t=localStorage.getItem("${SITE_THEME_KEY}")||localStorage.getItem("${STARLIGHT_THEME_KEY}")}catch(e){}var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.dataset.theme=d?"dark":"light"})()`
