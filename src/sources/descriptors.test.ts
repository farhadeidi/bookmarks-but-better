// @vitest-environment node

import { describe, expect, it } from "vitest"
import { describeSource } from "./descriptors"

describe("source display labels", () => {
  it("uses a profile-local label without losing the source-owned default", () => {
    expect(
      describeSource("daemon:http://127.0.0.1:52222#reading", {
        enabled: true,
        origin: "http://127.0.0.1:52222",
        vaultId: "reading",
        name: "Reading",
        label: "Research",
      })
    ).toMatchObject({
      label: "Research",
      defaultLabel: "Reading",
      vaultId: "reading",
    })
  })

  it("uses the default label when no local label exists", () => {
    expect(describeSource("browser", { enabled: true })).toMatchObject({
      label: "Browser bookmarks",
      defaultLabel: "Browser bookmarks",
    })
  })
})
