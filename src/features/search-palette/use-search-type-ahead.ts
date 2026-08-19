import * as React from "react"
import { useUIStore } from "@/stores/ui-store"

/**
 * Type-ahead is the palette's only way in from the keyboard: there is no
 * shortcut to remember, and no manifest key to keep in step across three
 * browsers. Whatever the page's focus is on, the first character typed goes
 * into the search box.
 */

function ownsTypedCharacter(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false

  if (target.closest("input, textarea, select")) return true
  if (target instanceof HTMLElement && target.isContentEditable) return true
  if (target.closest("[contenteditable]:not([contenteditable='false'])"))
    return true

  // A character typed inside another dialog belongs to that dialog — and to
  // the palette itself, whose input is already focused when it is open.
  return target.closest("[role='dialog'], [role='alertdialog']") !== null
}

/**
 * The character a keydown should open the palette with, or `null` when the
 * keystroke is not the user starting to type.
 *
 * `key.length === 1` is what separates "a" from "Enter" and "ArrowDown"
 * without listing every named key. Shift is the one modifier a typed
 * character legitimately carries; anything else is a shortcut the browser,
 * the page or an assistive technology owns. Space is excluded on its own: it
 * scrolls, and it would seed a query that trims away to nothing.
 */
export function typeAheadCharacter(event: KeyboardEvent): string | null {
  if (event.defaultPrevented) return null
  if (event.ctrlKey || event.metaKey || event.altKey) return null
  if (event.isComposing) return null
  if (event.key.length !== 1 || event.key === " ") return null
  if (ownsTypedCharacter(event.target)) return null

  return event.key
}

/** Installs the type-ahead listener for as long as the dashboard is mounted. */
export function useSearchTypeAhead(): void {
  const openSearchPalette = useUIStore((s) => s.openSearchPalette)

  React.useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const character = typeAheadCharacter(event)
      if (character === null) return

      // The keystroke seeds the palette instead of reaching the page —
      // Firefox's quick-find would otherwise start on the same character.
      event.preventDefault()
      openSearchPalette(character)
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [openSearchPalette])
}
