import { describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM } from '../../src/domain'
import {
  CAMERA_FOV_DEG,
  LENS_FACTOR,
  MAX_CAMERA_ALTITUDE_KM,
  MIN_CAMERA_ALTITUDE_KM,
  REFERENCE_FOV_DEG,
  START_CAMERA_ALTITUDE_KM,
  START_CAMERA_DISTANCE_RADII,
} from '../../src/features/mars-3d/constants'
import { rotateSpeedForAltitude } from '../../src/features/mars-3d/cameraMath'
import { GRID_LEVELS } from '../../src/features/mars-3d/gridLines'
import { STARFIELD_RADIUS } from '../../src/features/mars-3d/starPositions'
import { groundMetresPerPixel, zoomForView } from '../../src/features/mars-3d/tilePyramid'
import { kmPerPixel } from '../../src/features/mission-ui/scaleBarMath'

const R = MARS_MEAN_RADIUS_KM
const DEG = Math.PI / 180

describe('telephoto lens', () => {
  it('is a 25° lens, scaled from the 45° reference by the ratio of the half-angle tangents', () => {
    expect(CAMERA_FOV_DEG).toBe(25)
    expect(REFERENCE_FOV_DEG).toBe(45)
    expect(LENS_FACTOR).toBeCloseTo(Math.tan(22.5 * DEG) / Math.tan(12.5 * DEG), 12)
    expect(LENS_FACTOR).toBeCloseTo(1.868, 3)
  })

  it('keeps the ground scale at the floor: the same metres per pixel as 20 km with the reference lens', () => {
    const before = groundMetresPerPixel(20, REFERENCE_FOV_DEG, 900)
    const after = groundMetresPerPixel(MIN_CAMERA_ALTITUDE_KM, CAMERA_FOV_DEG, 900)
    expect(after).toBeCloseTo(before, 9)
    expect(after).toBeCloseTo(18.4, 1)
    expect(kmPerPixel(MIN_CAMERA_ALTITUDE_KM, CAMERA_FOV_DEG, 900)).toBeCloseTo(
      kmPerPixel(20, REFERENCE_FOV_DEG, 900)!,
      12,
    )
  })

  it('picks the same detail zoom at the floor as the reference lens would', () => {
    expect(zoomForView(MIN_CAMERA_ALTITUDE_KM, CAMERA_FOV_DEG, 900, 7, R)).toBe(7)
    expect(zoomForView(MIN_CAMERA_ALTITUDE_KM, CAMERA_FOV_DEG, 900, 7, R)).toBe(
      zoomForView(20, REFERENCE_FOV_DEG, 900, 7, R),
    )
    expect(zoomForView(MIN_CAMERA_ALTITUDE_KM, CAMERA_FOV_DEG, 900, 13, R)).toBe(
      zoomForView(20, REFERENCE_FOV_DEG, 900, 13, R),
    )
  })

  it('scales the ceiling, the start and the grid thresholds by the same factor', () => {
    expect(MAX_CAMERA_ALTITUDE_KM).toBeCloseTo(25000 * LENS_FACTOR, 9)
    expect(START_CAMERA_DISTANCE_RADII).toBeCloseTo(1 + 2.2 * LENS_FACTOR, 12)
    expect(START_CAMERA_ALTITUDE_KM).toBeCloseTo(2.2 * R * LENS_FACTOR, 6)
    const finite = GRID_LEVELS.filter((l) => Number.isFinite(l.maxAltitudeKm)).map((l) => l.maxAltitudeKm)
    expect(finite).toEqual([8000, 2500, 700].map((km) => km * LENS_FACTOR))
  })

  it('keeps the camera inside the starfield at the ceiling', () => {
    const distanceUnits = (R + MAX_CAMERA_ALTITUDE_KM) / 1000
    expect(distanceUnits).toBeLessThan(STARFIELD_RADIUS)
  })

  it('drags the ground at the same speed as before at every equivalent altitude', () => {
    const r = R / 1000
    for (const h of [0.2, 0.5, 1, 2, 5, 10]) {
      expect(rotateSpeedForAltitude(h * LENS_FACTOR, r, LENS_FACTOR)).toBeCloseTo(
        rotateSpeedForAltitude(h, r),
        12,
      )
    }
    expect(rotateSpeedForAltitude(0, r, LENS_FACTOR)).toBe(0.002)
  })
})
