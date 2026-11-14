import { describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM } from '../../src/domain'
import { makeFrame, toCoordinate } from '../../src/features/mars-3d/surfaceView/surfacePatch'
import {
  northOnPatch,
  screenHeadingDeg,
  walkerHeading,
} from '../../src/features/mars-3d/surfaceView/walkerHeading'

const DEG = Math.PI / 180

describe('screenHeadingDeg', () => {
  it.each([
    // [north on the patch, walker yaw, expected heading], all in degrees.
    [0, 0, 0], // facing north: north is up
    [0, 90, 270], // facing east: north is on the left
    [0, -90, 90], // facing west: north is on the right
    [0, 180, 180], // facing south: north is down
    [10, 0, 10], // north runs 10° right of the patch's +y
    [0, 0.4, 0], // rounds to the whole degree
    [0, 720 + 30, 330], // any number of full turns
  ])('north %s°, yaw %s° → %s°', (north, yaw, expected) => {
    expect(screenHeadingDeg(north * DEG, yaw * DEG)).toBe(expected)
  })
})

describe('northOnPatch', () => {
  it("is the patch's +y at the patch centre", () => {
    const frame = makeFrame({ latitude: 20, longitudeEast: 100 })
    expect(northOnPatch(frame, frame.centre)).toBeCloseTo(0, 6)
  })

  it('turns away from +y off the centre, more at high latitude (meridians converge)', () => {
    // 15 km east of the centre, north leans towards the pole's side: west.
    const low = makeFrame({ latitude: 10, longitudeEast: 0 })
    const high = makeFrame({ latitude: 75, longitudeEast: 0 })
    const atLow = northOnPatch(low, toCoordinate(low, 15, 0))!
    const atHigh = northOnPatch(high, toCoordinate(high, 15, 0))!
    expect(atLow).toBeLessThan(0)
    expect(atHigh).toBeLessThan(atLow)
    // Expected size: the longitude step times sin(latitude), here ~0.94°.
    const dLon = (15 / MARS_MEAN_RADIUS_KM / Math.cos(75 * DEG)) * Math.sin(75 * DEG)
    expect(-atHigh).toBeCloseTo(dLon, 4)
  })

  it('leans the other way in the southern hemisphere, and not at all on the equator', () => {
    // East of the centre, north leans away from the south pole: east.
    const south = makeFrame({ latitude: -45, longitudeEast: 30 })
    const north = makeFrame({ latitude: 45, longitudeEast: 30 })
    const equator = makeFrame({ latitude: 0, longitudeEast: 30 })
    const atSouth = northOnPatch(south, toCoordinate(south, 15, 0))!
    expect(atSouth).toBeGreaterThan(0)
    // Mirror images, to ~1e-7 rad: the 0.001° step north runs towards the
    // pole in one hemisphere and away from it in the other.
    expect(atSouth).toBeCloseTo(-northOnPatch(north, toCoordinate(north, 15, 0))!, 6)
    expect(northOnPatch(equator, toCoordinate(equator, 15, 0))).toBeCloseTo(0, 6)
  })

  it('is continuous across the 180° meridian', () => {
    // A patch centred on 180°E: points either side of the line are mirror images.
    const frame = makeFrame({ latitude: 60, longitudeEast: 180 })
    const east = northOnPatch(frame, toCoordinate(frame, 10, 0))!
    const west = northOnPatch(frame, toCoordinate(frame, -10, 0))!
    expect(east).toBeLessThan(0)
    expect(west).toBeCloseTo(-east, 9)
  })

  it('has no direction at either pole', () => {
    const top = makeFrame({ latitude: 89.9, longitudeEast: 0 })
    const bottom = makeFrame({ latitude: -89.9, longitudeEast: 0 })
    expect(northOnPatch(top, { latitude: 90, longitudeEast: 0 })).toBeNull()
    expect(northOnPatch(bottom, { latitude: -90, longitudeEast: 0 })).toBeNull()
    expect(northOnPatch(bottom, { latitude: -90, longitudeEast: 123 })).toBeNull()
  })
})

describe('walkerHeading', () => {
  it('is DERIVED with its method', () => {
    const h = walkerHeading(42)
    expect(h).toMatchObject({ classification: 'DERIVED', value: 42 })
    expect(h.classification === 'DERIVED' && h.method).toMatch(/true north at your position/)
  })

  it('is UNAVAILABLE with a reason near a pole, never a guessed angle', () => {
    const h = walkerHeading(null)
    expect(h.classification).toBe('UNAVAILABLE')
    expect(h.classification === 'UNAVAILABLE' && h.reason).toMatch(/pole/)
  })
})
