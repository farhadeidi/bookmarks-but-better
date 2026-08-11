import { beforeEach, describe, expect, it } from "vitest"
import { installFakeIndexedDB } from "./__tests__/fake-indexeddb"
import {
  getOnboardingCompleted,
  setOnboardingCompleted,
} from "./onboarding-preference"

beforeEach(() => {
  installFakeIndexedDB()
})

describe("onboarding preference", () => {
  it("distinguishes an unset profile from explicit completion state", async () => {
    expect(await getOnboardingCompleted()).toBeNull()

    await setOnboardingCompleted(true)
    expect(await getOnboardingCompleted()).toBe(true)

    await setOnboardingCompleted(false)
    expect(await getOnboardingCompleted()).toBe(false)
  })
})
