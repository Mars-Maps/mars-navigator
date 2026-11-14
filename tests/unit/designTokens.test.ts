import { afterEach, describe, expect, it, vi } from 'vitest'
import { OUTLINE_FALLBACK, tokenColor } from '../../src/features/mars-3d/designTokens'

describe('tokenColor', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('falls back where there is no document', () => {
    expect(tokenColor('--color-canvas', OUTLINE_FALLBACK)).toBe(OUTLINE_FALLBACK)
  })

  it('reads the token from :root, trimmed, and falls back when it is missing', () => {
    vi.stubGlobal('document', { documentElement: {} })
    const values: Record<string, string> = { '--color-canvas': ' #101112 ' }
    vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (n: string) => values[n] ?? '' }))
    expect(tokenColor('--color-canvas', OUTLINE_FALLBACK)).toBe('#101112')
    expect(tokenColor('--color-missing', OUTLINE_FALLBACK)).toBe(OUTLINE_FALLBACK)
  })
})
