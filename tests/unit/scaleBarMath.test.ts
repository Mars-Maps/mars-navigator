import { describe, expect, it } from 'vitest'
import { formatLength, kmPerPixel, niceLength } from '../../src/features/mission-ui/scaleBarMath'

describe('kmPerPixel', () => {
  it('is the ground span of the field of view divided by the window height', () => {
    // fov 90°: tan(45°) = 1, so the span is 2 × altitude.
    expect(kmPerPixel(1000, 90, 1000)).toBeCloseTo(2, 12)
  })

  it('doubles when the altitude doubles', () => {
    const a = kmPerPixel(500, 45, 900)!
    const b = kmPerPixel(1000, 45, 900)!
    expect(b / a).toBeCloseTo(2, 12)
  })

  it('halves when the window is twice as tall', () => {
    expect(kmPerPixel(1000, 45, 1800)! * 2).toBeCloseTo(kmPerPixel(1000, 45, 900)!, 12)
  })

  it.each([
    ['zero altitude', 0, 45, 900],
    ['negative altitude', -5, 45, 900],
    ['NaN altitude', NaN, 45, 900],
    ['zero fov', 100, 0, 900],
    ['fov of 180°', 100, 180, 900],
    ['zero height', 100, 45, 0],
  ])('is null for %s', (_name, altitude, fov, height) => {
    expect(kmPerPixel(altitude, fov, height)).toBeNull()
  })
})

describe('niceLength', () => {
  it('picks the longest 1, 2 or 5 × 10ⁿ that fits', () => {
    // 1 km/px, 120 px: 100 fits, 200 does not.
    expect(niceLength(1, 120)?.km).toBe(100)
    // 1 km/px, 250 px: 200 fits, 500 does not.
    expect(niceLength(1, 250)?.km).toBe(200)
    // 1 km/px, 600 px: 500 fits, 1000 does not.
    expect(niceLength(1, 600)?.km).toBe(500)
  })

  it('accepts a length exactly equal to the maximum', () => {
    expect(niceLength(1, 100)).toEqual({ km: 100, widthPx: 100 })
    expect(niceLength(1, 1000)).toEqual({ km: 1000, widthPx: 1000 })
  })

  it('never draws wider than the maximum', () => {
    for (const kmPerPx of [0.0007, 0.013, 0.4, 1, 3.3, 17, 61.5, 290]) {
      for (const maxPx of [40, 120, 333]) {
        const out = niceLength(kmPerPx, maxPx)!
        expect(out.widthPx).toBeLessThanOrEqual(maxPx)
        expect(out.widthPx).toBeCloseTo(out.km / kmPerPx, 9)
      }
    }
  })

  it('only returns 1, 2 or 5 × a power of ten', () => {
    for (const kmPerPx of [0.0007, 0.013, 0.4, 3.3, 17, 61.5, 290]) {
      const km = niceLength(kmPerPx, 120)!.km
      const mantissa = km / 10 ** Math.floor(Math.log10(km))
      expect([1, 2, 5]).toContain(Math.round(mantissa * 1e6) / 1e6)
    }
  })

  it('gives sub-kilometre lengths close to the surface', () => {
    // 0.0005 km/px × 120 px = 0.06 km → 0.05 km = 50 m.
    expect(niceLength(0.0005, 120)?.km).toBeCloseTo(0.05, 12)
  })

  it.each([
    ['a null scale', null, 120],
    ['a zero scale', 0, 120],
    ['a NaN scale', NaN, 120],
    ['no room', 1, 0],
  ])('is null for %s', (_name, kmPerPx, maxPx) => {
    expect(niceLength(kmPerPx, maxPx)).toBeNull()
  })
})

describe('formatLength', () => {
  it('writes kilometres from 1 km up, with a thousands separator', () => {
    expect(formatLength(1)).toBe('1 km')
    expect(formatLength(500)).toBe('500 km')
    expect(formatLength(2000)).toBe('2,000 km')
  })

  it('writes metres below 1 km', () => {
    expect(formatLength(0.5)).toBe('500 m')
    expect(formatLength(0.05)).toBe('50 m')
  })
})
