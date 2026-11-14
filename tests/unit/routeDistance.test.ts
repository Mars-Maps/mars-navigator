import { describe, expect, it } from 'vitest'
import {
  unavailable,
  type Classified,
  type ExplorationRoute,
} from '../../src/domain'
import { routeLengthKm } from '../../src/features/route-analysis/routeDistance'

/** Builds a route from [latitude, longitudeEast] pairs. Test fixture only. */
function route(...coords: [number, number][]): ExplorationRoute {
  return {
    id: 'test-route',
    name: 'Test route',
    classification: 'SIMULATED',
    points: coords.map(([latitude, longitudeEast], i) => ({
      id: `p${i}`,
      coordinate: { latitude, longitudeEast },
      elevationMeters: unavailable('Not needed for distance'),
    })),
  }
}

function valueOf(v: Classified<number>): number {
  if (v.classification === 'UNAVAILABLE') throw new Error(`Expected a value, got: ${v.reason}`)
  return v.value
}

describe('routeLengthKm', () => {
  it('is UNAVAILABLE for an empty route, with a reason', () => {
    const result = routeLengthKm(route())
    expect(result.classification).toBe('UNAVAILABLE')
    expect(result).toHaveProperty('reason', expect.stringMatching(/two points/))
  })

  it('is UNAVAILABLE for a single-point route, not zero', () => {
    const result = routeLengthKm(route([10, 20]))
    expect(result.classification).toBe('UNAVAILABLE')
    expect(result).not.toHaveProperty('value')
  })

  it('is a DERIVED zero for two identical points', () => {
    const result = routeLengthKm(route([10, 20], [10, 20]))
    expect(result.classification).toBe('DERIVED')
    expect(valueOf(result)).toBe(0)
  })

  it('ignores duplicate consecutive points mid-route', () => {
    const plain = valueOf(routeLengthKm(route([0, 0], [0, 90], [0, 180])))
    const withDup = valueOf(routeLengthKm(route([0, 0], [0, 90], [0, 90], [0, 180])))
    expect(withDup).toBeCloseTo(plain, 9)
  })

  it('measures a quarter of the equator as πR/2 ≈ 5324.2 km', () => {
    // Hand check: π × 3389.5 / 2 = 5324.215…
    expect(valueOf(routeLengthKm(route([0, 0], [0, 90])))).toBeCloseTo(5324.2, 1)
  })

  it('sums segments: 0°→90°→180°E along the equator is πR ≈ 10648.4 km', () => {
    // Hand check: π × 3389.5 = 10648.43…
    expect(valueOf(routeLengthKm(route([0, 0], [0, 90], [0, 180])))).toBeCloseTo(10648.4, 1)
  })

  it('takes the short way across the 0/360 longitude seam', () => {
    // 359°E → 1°E is 2° of arc: 2π × 3389.5 / 180 = 118.31… km, not 358°.
    expect(valueOf(routeLengthKm(route([0, 359], [0, 1])))).toBeCloseTo(118.3, 1)
  })

  it('states its method', () => {
    const result = routeLengthKm(route([0, 0], [0, 90]))
    expect(result).toHaveProperty('method', expect.stringMatching(/Haversine/))
  })
})
