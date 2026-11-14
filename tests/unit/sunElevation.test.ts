import { describe, expect, it } from 'vitest'
import { sunElevationAt } from '../../src/app/sunElevation'
import { derived, unavailable, type MarsCoordinate } from '../../src/domain'
import { skyAt } from '../../src/features/mars-3d/sky/skyPositions'

// Test fixtures only: a position near Jezero and fixed instants.
const AT: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.4 }
const NOON_ISH = Date.UTC(2026, 10, 2, 12, 0)

describe('sunElevationAt', () => {
  it('gives the altitude the sky places the sun at, DERIVED with the method', () => {
    const sun = sunElevationAt(NOON_ISH, derived(AT, 'fixture'))
    if (sun.classification !== 'DERIVED') throw new Error(`expected a figure: ${JSON.stringify(sun)}`)
    const placement = skyAt(NOON_ISH, AT).find((b) => b.id === 'sun')?.placement
    if (placement?.classification !== 'DERIVED') throw new Error('expected the sky to place the sun')
    expect(sun.value).toBe(placement.value.altitudeDeg)
    expect(sun.value).toBeGreaterThanOrEqual(-90)
    expect(sun.value).toBeLessThanOrEqual(90)
    expect(sun.method).toContain('surface view')
  })

  it('moves through a sol: up at one hour, down at another', () => {
    const altitudes = Array.from({ length: 25 }, (_, h) => sunElevationAt(NOON_ISH + h * 3_600_000, derived(AT, 'fixture')))
    const values = altitudes.map((a) => (a.classification === 'DERIVED' ? a.value : Number.NaN))
    expect(Math.max(...values)).toBeGreaterThan(0)
    expect(Math.min(...values)).toBeLessThan(0)
  })

  it('is UNAVAILABLE with the reason without a position, never 0', () => {
    const sun = sunElevationAt(NOON_ISH, unavailable('fixture: no fix'))
    expect(sun.classification).toBe('UNAVAILABLE')
    expect(JSON.stringify(sun)).toContain('fixture: no fix')
  })

  it('is UNAVAILABLE outside the sky model’s years', () => {
    expect(sunElevationAt(Date.UTC(2200, 0, 1), derived(AT, 'fixture')).classification).toBe('UNAVAILABLE')
  })
})
