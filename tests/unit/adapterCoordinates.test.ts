import { describe, expect, it } from 'vitest'
import { toLongitudeEast, toMarsCoordinate } from '../../src/data/adapters/coordinates'
import { MockDataAdapter } from '../../src/data/adapters/MockDataAdapter'
import { isValidCoordinate } from '../../src/domain'

describe('toLongitudeEast', () => {
  it.each([
    [0, 0],
    [137.4, 137.4],
    [-137.4, 222.6],
    [-0.0001, 359.9999],
    // −180 and 180 are the same meridian.
    [-180, 180],
    [180, 180],
  ])('east-180: %d → %d', (lon, expected) => {
    expect(toLongitudeEast(lon, 'east-180')).toBeCloseTo(expected, 9)
  })

  it.each([
    [0, 0],
    [359.99, 359.99],
    // The closed grid edge wraps; 360 is 0.
    [360, 0],
  ])('east-360: %d → %d', (lon, expected) => {
    expect(toLongitudeEast(lon, 'east-360')).toBe(expected)
  })

  it.each([
    [0, 0],
    [90, 270],
    [270, 90],
    [137.4, 222.6],
    [360, 0],
  ])('west-360: %d°W → %d°E', (lon, expected) => {
    expect(toLongitudeEast(lon, 'west-360')).toBeCloseTo(expected, 9)
  })

  it('never returns −0', () => {
    expect(Object.is(toLongitudeEast(0, 'west-360'), 0)).toBe(true)
    expect(Object.is(toLongitudeEast(360, 'west-360'), 0)).toBe(true)
  })

  it.each([
    [180.0001, 'east-180'],
    [-200, 'east-180'],
    [-0.1, 'east-360'],
    [360.1, 'east-360'],
    [-1, 'west-360'],
    [400, 'west-360'],
    [Number.NaN, 'east-360'],
    [Number.NEGATIVE_INFINITY, 'east-180'],
  ] as const)('rejects %d in %s instead of wrapping it', (lon, from) => {
    expect(toLongitudeEast(lon, from)).toBeNull()
  })
})

describe('toMarsCoordinate', () => {
  it('converts a valid pair, poles included', () => {
    expect(toMarsCoordinate(90, -180, 'east-180')).toEqual({
      ok: true,
      coordinate: { latitude: 90, longitudeEast: 180 },
    })
    expect(toMarsCoordinate(-90, 0, 'west-360')).toEqual({
      ok: true,
      coordinate: { latitude: -90, longitudeEast: 0 },
    })
  })

  it.each([
    [91, 0, 'latitude-range'],
    [0, 200, 'longitude-range'],
    [0, Number.NaN, 'format'],
    [Number.NaN, 0, 'format'],
  ])('rejects lat=%d lon=%d as %s', (lat, lon, reason) => {
    expect(toMarsCoordinate(lat, lon, 'east-180')).toEqual({ ok: false, reason })
  })
})

describe('MockDataAdapter coordinates', () => {
  it('converts the simulated ±180 source into valid 0–360°E coordinates', async () => {
    const dataset = await new MockDataAdapter().load()
    const points = dataset.routes[0].points
    expect(points.every((p) => isValidCoordinate(p.coordinate))).toBe(true)
    expect(points[0].coordinate).toEqual({ latitude: -4.5, longitudeEast: 137.4 })
  })
})
