import { describe, expect, it } from 'vitest'
import type { Classified } from '../../src/domain'
import {
  compassHeading,
  compassShown,
  headingText,
  normalizeHeading,
} from '../../src/features/mission-ui/compassMath'
import type { CameraView } from '../../src/state'

describe('normalizeHeading', () => {
  it.each([
    [0, 0],
    [359.9, 359.9],
    [360, 0],
    [725, 5],
    [-90, 270],
    [-360, 0],
  ])('wraps %s into [0, 360) as %s', (input, expected) => {
    expect(normalizeHeading(input)).toBeCloseTo(expected, 9)
  })

  it('never returns 360 for a tiny negative heading', () => {
    const h = normalizeHeading(-1e-15)!
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThan(360)
  })

  it.each([NaN, Infinity, -Infinity])('rejects %s', (input) => {
    expect(normalizeHeading(input)).toBeNull()
  })
})

describe('headingText', () => {
  it.each([
    [0, 'North is up'],
    [360, 'North is up'],
    [359.6, 'North is up'],
    [25, 'North is 25° right of up'],
    [90, 'North is 90° right of up'],
    [180, 'North is down'],
    [270, 'North is 90° left of up'],
    [-25, 'North is 25° left of up'],
    [359.4, 'North is 1° left of up'],
  ])('describes %s as "%s"', (input, expected) => {
    expect(headingText(input)).toBe(expected)
  })

  it.each([NaN, Infinity, -Infinity])('has no text for %s', (input) => {
    expect(headingText(input)).toBeNull()
  })
})

describe('compassHeading', () => {
  const view = (headingDeg: Classified<number>): CameraView => ({
    altitudeKm: 3000,
    target: { latitude: -4.6, longitudeEast: 137.4 },
    headingDeg,
  })
  const derived: Classified<number> = { classification: 'DERIVED', value: 23.5, method: 'camera axes' }
  const atPole: Classified<number> = { classification: 'UNAVAILABLE', reason: 'At a pole' }

  it.each(['welcome', 'close-up', 'navigation'] as const)(
    'passes the camera heading through in %s',
    (mode) => {
      expect(compassHeading(mode, view(derived))).toBe(derived)
    },
  )

  it("keeps the camera's own reason at a pole", () => {
    expect(compassHeading('close-up', view(atPole))).toBe(atPole)
  })

  it('is UNAVAILABLE with a reason before the camera reports a view', () => {
    const h = compassHeading('close-up', null)
    expect(h.classification).toBe('UNAVAILABLE')
    expect(h.classification === 'UNAVAILABLE' && h.reason).toMatch(/not reported a view/)
  })

  it("shows the walker's heading on the surface, never the orbit camera's", () => {
    const walker: Classified<number> = { classification: 'DERIVED', value: 270, method: 'walker' }
    expect(compassHeading('surface', view(derived), walker)).toBe(walker)
  })

  it('is UNAVAILABLE on the surface until the ground view reports a heading', () => {
    const h = compassHeading('surface', view(derived), null)
    expect(h.classification).toBe('UNAVAILABLE')
    expect(h.classification === 'UNAVAILABLE' && h.reason).toMatch(/ground view/)
  })

  it("ignores a walker heading outside the surface", () => {
    const walker: Classified<number> = { classification: 'DERIVED', value: 270, method: 'walker' }
    expect(compassHeading('close-up', view(derived), walker)).toBe(derived)
  })
})

describe('compassShown', () => {
  it('is always on while standing on the surface', () => {
    expect(compassShown('surface', false)).toBe(true)
    expect(compassShown('surface', true)).toBe(true)
  })

  it.each(['welcome', 'close-up', 'navigation'] as const)('follows the button in %s', (mode) => {
    expect(compassShown(mode, true)).toBe(true)
    expect(compassShown(mode, false)).toBe(false)
  })
})
