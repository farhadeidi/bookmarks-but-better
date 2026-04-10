export type ScreenshotMode = false | 'default' | 'onboarding'

export function useScreenshotMode(): ScreenshotMode {
  const param = new URLSearchParams(location.search).get('screenshot')
  if (param === 'onboarding') return 'onboarding'
  if (param === 'true') return 'default'
  return false
}
