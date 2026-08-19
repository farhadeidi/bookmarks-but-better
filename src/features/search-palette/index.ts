// The type-ahead hook is deliberately not re-exported here: it has to be
// mounted eagerly, and importing it through this barrel would pull the
// palette's chunk into the initial bundle it is lazily split out of.
export { SearchPaletteDialog } from "./search-palette-dialog"
