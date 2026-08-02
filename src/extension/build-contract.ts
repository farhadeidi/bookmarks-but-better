export const BACKGROUND_OUTPUT_FILE = "background.js"
export const BACKGROUND_OUTPUT_FORMAT = "iife"

export function buildEntryNames(
  buildTarget: string | undefined
): readonly string[] {
  return buildTarget === "daemon" ? ["index"] : ["index", "popup", "background"]
}
