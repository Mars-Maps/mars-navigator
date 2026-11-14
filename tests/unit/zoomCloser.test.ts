import { describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM } from '../../src/domain'
import { nearForAltitude, rotateSpeedForAltitude } from '../../src/features/mars-3d/cameraMath'
import { CAMERA_FOV_DEG, FRAME_MIN_ALTITUDE_KM, GLOBE_RADIUS, GROUND_BELOW_ALTITUDE_KM, KM_PER_SCENE_UNIT, LENS_FACTOR, MIN_CAMERA_ALTITUDE_KM } from '../../src/features/mars-3d/constants'
import { globalGroundImagery, type GroundImagery } from '../../src/features/mars-3d/surfaceDetail'
import { tilesForView, zoomForView } from '../../src/features/mars-3d/tilePyramid'
import { FINE_HOVER_BELOW_KM, hoverDecimals } from '../../src/state'

const R = MARS_MEAN_RADIUS_KM
/** A 1440 × 900 window on a 2× screen, as the tiles are matched to device pixels. */
const SCREEN = { fovDeg: CAMERA_FOV_DEG, heightPx: 1800, aspect: 1440 / 900 }
const JEZERO = { latitude: 18.4, longitudeEast: 77.5 }

describe('the altitude floor', () => {
  it('is 20 km with the reference lens', () => {
    expect(MIN_CAMERA_ALTITUDE_KM).toBeCloseTo(20 * LENS_FACTOR, 9)
  })

  it('is where the global CTX mosaic reaches its finest zoom, so the ground stays sharp to the floor', () => {
    // CTX serves zoom 11 in 512 px tiles: one zoom coarser than 256 px tiles would need.
    expect(zoomForView(MIN_CAMERA_ALTITUDE_KM, SCREEN.fovDeg, SCREEN.heightPx, 11, R, 512)).toBe(11)
    // Twice as high, it does not need the finest zoom yet.
    expect(zoomForView(2 * MIN_CAMERA_ALTITUDE_KM, SCREEN.fovDeg, SCREEN.heightPx, 11, R, 512)).toBeLessThan(11)
  })
})

describe('tilesForView with a tile width and a source it fills in for', () => {
  it('asks a 512 px source for one zoom coarser than a 256 px one at the same view', () => {
    const view = { altitudeKm: 120, target: JEZERO }
    const z256 = tilesForView(view, SCREEN, 13, R)!.zoom
    const z512 = tilesForView(view, SCREEN, 13, R, { tilePx: 512 })!.zoom
    expect(z512).toBe(z256 - 1)
  })

  it('draws nothing while the other source is still as fine as the screen asks', () => {
    // The satellite layer stops at zoom 7: high up, it is still fine enough.
    expect(tilesForView({ altitudeKm: 3000, target: JEZERO }, SCREEN, 11, R, { tilePx: 512, finerThan: { maxZoom: 7 } })).toBeNull()
  })

  it('fills in once the other source runs out', () => {
    const shown = tilesForView({ altitudeKm: MIN_CAMERA_ALTITUDE_KM, target: JEZERO }, SCREEN, 11, R, {
      tilePx: 512,
      finerThan: { maxZoom: 7 },
    })
    expect(shown?.zoom).toBe(11)
    expect(shown!.tiles.length).toBeGreaterThan(0)
    expect(shown!.tiles.length).toBeLessThanOrEqual(300)
  })
})

describe('globalGroundImagery', () => {
  const g = (coverage: GroundImagery['coverage'], nearField?: boolean) => ({ coverage, nearField }) as GroundImagery
  it('takes the planet-wide mosaic, never a site mosaic or a near-field one', () => {
    const site = g({ south: 18, north: 19, west: 77, east: 78 })
    const near = g(null, true)
    const global = g(null)
    expect(globalGroundImagery([site, near, global])).toBe(global)
    expect(globalGroundImagery([site, near])).toBeNull()
    expect(globalGroundImagery([])).toBeNull()
  })
})

describe('hoverDecimals', () => {
  it('shows one decimal high up and before the camera settles, two below 100 km', () => {
    expect(hoverDecimals(null)).toBe(1)
    expect(hoverDecimals(5000)).toBe(1)
    expect(hoverDecimals(FINE_HOVER_BELOW_KM)).toBe(1)
    expect(hoverDecimals(FINE_HOVER_BELOW_KM - 1)).toBe(2)
    expect(hoverDecimals(MIN_CAMERA_ALTITUDE_KM)).toBe(2)
  })
})

describe('the camera close to the floor', () => {
  const floor = MIN_CAMERA_ALTITUDE_KM / KM_PER_SCENE_UNIT
  it('drags at the formula’s speed down to the floor, not a clamp ten times faster', () => {
    const atFloor = rotateSpeedForAltitude(floor, GLOBE_RADIUS, LENS_FACTOR)
    expect(atFloor).toBeCloseTo(floor / (GLOBE_RADIUS * 2.2 * LENS_FACTOR), 9)
    expect(atFloor).toBeLessThan(0.004)
    // At the old floor it is what it was.
    expect(rotateSpeedForAltitude(FRAME_MIN_ALTITUDE_KM / KM_PER_SCENE_UNIT, GLOBE_RADIUS, LENS_FACTOR)).toBeCloseTo(0.027, 3)
  })

  it('keeps the near plane at 100 km up high and lowers it only close in', () => {
    expect(nearForAltitude(10)).toBe(0.1)
    expect(nearForAltitude(FRAME_MIN_ALTITUDE_KM / KM_PER_SCENE_UNIT)).toBeCloseTo(0.0934, 4)
    expect(nearForAltitude(floor)).toBe(0.01)
    // Always in front of the ground below the camera.
    expect(nearForAltitude(floor)).toBeLessThan(floor)
  })
})

describe('where the CTX ground starts', () => {
  it('is under the lowest a flight frames by more than the camera settles short of its goal', () => {
    // The camera stops within 1e-4 scene units (0.1 km) of its goal, above or below.
    expect(FRAME_MIN_ALTITUDE_KM - GROUND_BELOW_ALTITUDE_KM).toBeGreaterThan(1)
    expect(GROUND_BELOW_ALTITUDE_KM).toBeGreaterThan(MIN_CAMERA_ALTITUDE_KM)
  })
})
