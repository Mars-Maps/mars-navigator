import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import { isAvailable, marsSolarTime, type MarsSolarTime } from '../../src/domain'
import { localPointToCoordinate } from '../../src/features/mars-3d/projection'
import {
  NEUTRAL_INTENSITY,
  SHADING_FADE_SECONDS,
  ambientIntensity,
  sunIntensity,
  shadingTarget,
  stepShading,
  NIGHT_INTENSITY,
  SUN_INTENSITY,
  sunDirection,
} from '../../src/features/mars-3d/sunMath'

/** A solar time whose only field under test is the subsolar point. */
const over = (latitude: number, longitudeEast: number): MarsSolarTime => ({
  marsSolDate: 0,
  coordinatedMarsTimeHours: 0,
  heliocentricDistanceAu: 1.52,
  solarLongitudeDeg: 0,
  equationOfTimeDeg: 0,
  subsolarPoint: { latitude, longitudeEast },
})

describe('sunDirection', () => {
  it('points at the texture centre for 0°N 0°E, which the globe shows on +X', () => {
    const d = sunDirection(over(0, 0))
    expect(d.x).toBeCloseTo(1, 12)
    expect(d.y).toBeCloseTo(0, 12)
    expect(d.z).toBeCloseTo(0, 12)
  })

  it('follows the poles and the quarter meridians', () => {
    expect(sunDirection(over(90, 0)).y).toBeCloseTo(1, 12)
    expect(sunDirection(over(-90, 0)).y).toBeCloseTo(-1, 12)
    expect(sunDirection(over(0, 180)).x).toBeCloseTo(-1, 12)
    const east = sunDirection(over(0, 90))
    expect(east.x).toBeCloseTo(0, 12)
    expect(east.z).toBeCloseTo(-1, 12)
    const west = sunDirection(over(0, 270))
    expect(west.z).toBeCloseTo(1, 12)
  })

  it('is a unit vector whose surface point is the subsolar point, so moving the time moves the terminator', () => {
    // The GISS worked example (mars24.test.ts): sun over 25.228°S, 185.274°E.
    const solar = marsSolarTime(Date.UTC(2000, 0, 6))
    if (!isAvailable(solar)) throw new Error('expected a value')
    const d = sunDirection(solar.value)
    expect(d.length()).toBeCloseTo(1, 12)
    const back = localPointToCoordinate(d, 1)
    expect(back.latitude).toBeCloseTo(-25.22825, 4)
    expect(back.longitudeEast).toBeCloseTo(185.274, 3)
    // Half a sol later the sun is over the opposite meridian, same latitude.
    const later = marsSolarTime(Date.UTC(2000, 0, 6) + 12 * 3698.9685 * 1000)
    if (!isAvailable(later)) throw new Error('expected a value')
    const then = localPointToCoordinate(sunDirection(later.value), 1)
    expect((then.longitudeEast - back.longitudeEast + 360) % 360).toBeCloseTo(180, 0)
    expect(then.latitude).toBeCloseTo(back.latitude, 0)
  })

  it('writes into the given vector and allocates nothing otherwise', () => {
    const target = new Vector3()
    expect(sunDirection(over(0, 0), target)).toBe(target)
  })
})

describe('lighting intensities', () => {
  it('add up to the neutral level, so the subsolar point is as bright as the unlit globe was', () => {
    expect(SUN_INTENSITY + NIGHT_INTENSITY).toBeCloseTo(NEUTRAL_INTENSITY, 12)
    // Lambert divides irradiance by π: π restores the texture's brightness.
    expect(NEUTRAL_INTENSITY).toBeCloseTo(Math.PI, 12)
  })

  it('keep the night side visible but clearly darker than day', () => {
    expect(NIGHT_INTENSITY).toBeGreaterThan(0)
    expect(NIGHT_INTENSITY / NEUTRAL_INTENSITY).toBeLessThanOrEqual(0.3)
  })
})

describe('sun shading on and off', () => {
  it('shades while the toggle is on, even light while it is off', () => {
    expect(shadingTarget(true)).toBe(1)
    expect(shadingTarget(false)).toBe(0)
  })

  it('fades at a constant rate and stops at the target', () => {
    expect(stepShading(1, 0, SHADING_FADE_SECONDS / 2)).toBeCloseTo(0.5)
    expect(stepShading(0.1, 0, 1)).toBe(0)
    expect(stepShading(0.9, 1, 1)).toBe(1)
    expect(stepShading(1, 1, 0.016)).toBe(1)
  })

  it('blends from sun and night floor to the even, unlit look', () => {
    expect(ambientIntensity(1)).toBeCloseTo(NIGHT_INTENSITY)
    expect(sunIntensity(1)).toBe(SUN_INTENSITY)
    expect(ambientIntensity(0)).toBe(NEUTRAL_INTENSITY)
    expect(sunIntensity(0)).toBe(0)
  })
})
