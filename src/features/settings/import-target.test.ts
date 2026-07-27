import { describe, expect, it } from "vitest"
import { resolveImportRootId } from "./import-target"

describe("resolveImportRootId", () => {
  it("returns the selected root folder id unchanged", () => {
    expect(resolveImportRootId("42")).toBe("42")
  })

  it('throws a clear error instead of assuming root id "0" when no root folder is set', () => {
    expect(() => resolveImportRootId(null)).toThrow(/root folder/i)
  })
})
