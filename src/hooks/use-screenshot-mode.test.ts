import { describe, it, expect, vi, afterEach } from 'vitest'
import { getScreenshotMode } from './use-screenshot-mode'

afterEach(() => vi.unstubAllGlobals())

describe('getScreenshotMode', () => {
  it('returns false when no query param is present', () => {
    vi.stubGlobal('location', { search: '' })
    expect(getScreenshotMode()).toBe(false)
  })

  it('returns "default" for ?screenshot=true', () => {
    vi.stubGlobal('location', { search: '?screenshot=true' })
    expect(getScreenshotMode()).toBe('default')
  })

  it('returns "onboarding" for ?screenshot=onboarding', () => {
    vi.stubGlobal('location', { search: '?screenshot=onboarding' })
    expect(getScreenshotMode()).toBe('onboarding')
  })

  it('returns false for an unknown param value', () => {
    vi.stubGlobal('location', { search: '?screenshot=foobar' })
    expect(getScreenshotMode()).toBe(false)
  })
})
