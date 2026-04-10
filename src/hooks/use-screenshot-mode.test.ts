import { describe, it, expect, vi, afterEach } from 'vitest'
import { useScreenshotMode } from './use-screenshot-mode'

afterEach(() => vi.unstubAllGlobals())

describe('useScreenshotMode', () => {
  it('returns false when no query param is present', () => {
    vi.stubGlobal('location', { search: '' })
    expect(useScreenshotMode()).toBe(false)
  })

  it('returns "default" for ?screenshot=true', () => {
    vi.stubGlobal('location', { search: '?screenshot=true' })
    expect(useScreenshotMode()).toBe('default')
  })

  it('returns "onboarding" for ?screenshot=onboarding', () => {
    vi.stubGlobal('location', { search: '?screenshot=onboarding' })
    expect(useScreenshotMode()).toBe('onboarding')
  })

  it('returns false for an unknown param value', () => {
    vi.stubGlobal('location', { search: '?screenshot=foobar' })
    expect(useScreenshotMode()).toBe(false)
  })
})
