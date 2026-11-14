import { describe, expect, it } from 'vitest'
import type { Classified } from '../../src/domain'
import { distanceAndBearing } from '../../src/features/route-analysis/distanceAndBearing'

const at = (latitude: number, longitudeEast: number) => ({ latitude, longitudeEast })

function valueOf(v: Classified<number>): number {
  if (v.classification === 'UNAVAILABLE') throw new Error(`Expected a value, got: ${v.reason}`)
  return v.value
}

const bearing = (from: [number, number], to: [number, number]) =>
  valueOf(distanceAndBearing(at(...from), at(...to)).initialBearingDeg)

describe('distanceAndBearing', () => {
  it.each([
    ['north', [0, 10], [10, 10], 0],
    ['east', [0, 10], [0, 20], 90],
    ['south', [0, 10], [-10, 10], 180],
    ['west', [0, 20], [0, 10], 270],
  ] as const)('heads due %s', (_, from, to, expected) => {
    expect(bearing([...from], [...to])).toBeCloseTo(expected, 9)
  })

  it('matches a hand-checked example: (0°, 0°E) → (45°N, 90°E)', () => {
    // y = sin 90° · cos 45° = 0.7071, x = cos 0° · sin 45° − 0 = 0.7071
    // bearing = atan2(y, x) = 45°.
    // cos c = sin 0 · sin 45 + cos 0 · cos 45 · cos 90 = 0, so c = 90° → πR/2.
    const result = distanceAndBearing(at(0, 0), at(45, 90))
    expect(valueOf(result.initialBearingDeg)).toBeCloseTo(45, 9)
    expect(valueOf(result.distanceKm)).toBeCloseTo(5324.2, 1)
  })

  it('crosses the 0/360 seam the short way in both directions', () => {
    expect(bearing([0, 359], [0, 1])).toBeCloseTo(90, 9)
    expect(bearing([0, 1], [0, 359])).toBeCloseTo(270, 9)
  })

  it('keeps bearing in the range 0 to <360', () => {
    const b = bearing([10, 10], [20, 5])
    expect(b).toBeGreaterThanOrEqual(0)
    expect(b).toBeLessThan(360)
    expect(b).toBeGreaterThan(270) // north-west
  })

  it('heads north to reach the north pole', () => {
    expect(bearing([10, 123], [90, 0])).toBeCloseTo(0, 9)
  })

  it('identical points: distance is a DERIVED 0, bearing is UNAVAILABLE', () => {
    const result = distanceAndBearing(at(10, 20), at(10, 20))
    expect(result.distanceKm).toMatchObject({ classification: 'DERIVED', value: 0 })
    expect(result.initialBearingDeg.classification).toBe('UNAVAILABLE')
  })

  it('0°E and 360°E are the same point: bearing is UNAVAILABLE, not invented', () => {
    const result = distanceAndBearing(at(0, 0), at(0, 360))
    expect(valueOf(result.distanceKm)).toBeCloseTo(0, 9)
    expect(result.initialBearingDeg).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'Points are identical; no direction',
    })
  })

  it('bearing is UNAVAILABLE when starting at a pole', () => {
    const result = distanceAndBearing(at(-90, 0), at(0, 45))
    expect(result.initialBearingDeg.classification).toBe('UNAVAILABLE')
    expect(result.distanceKm.classification).toBe('DERIVED')
  })

  it('bearing is UNAVAILABLE for antipodal points', () => {
    const result = distanceAndBearing(at(20, 30), at(-20, 210))
    expect(result.initialBearingDeg.classification).toBe('UNAVAILABLE')
    expect(valueOf(result.distanceKm)).toBeCloseTo(10648.4, 1)
  })

  it('states the method of both values', () => {
    const result = distanceAndBearing(at(0, 0), at(10, 10))
    expect(result.distanceKm).toHaveProperty('method', expect.stringMatching(/Haversine/))
    expect(result.initialBearingDeg).toHaveProperty('method', expect.stringMatching(/bearing/))
  })
})
