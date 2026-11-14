import { describe, expect, it } from 'vitest'
import { derived, official, simulated, unavailable } from '../../src/domain'
import {
  aimedPoint,
  ARRIVAL_KM,
  directionText,
  formatWayDistance,
  isReached,
  pointerAngle,
  shownDistance,
  type WayPoint,
} from '../../src/features/mission-ui/hud/wayPointerMath'

// Test fixtures only — invented headings, distances and bearings, never shown in the app.
const METHOD = 'fixture-method'

/** A point `km` away (null: distance unknown), due north. */
const at = (km: number | null): WayPoint => ({
  label: 'fixture-point',
  distanceKm: km === null ? unavailable('fixture-reason') : derived(km, METHOD),
  bearingDeg: derived(0, METHOD),
})
const route = (...kms: (number | null)[]) => kms.map(at)

describe('pointerAngle', () => {
  it.each([
    // [heading: north from straight ahead, bearing to the point, arrow from straight ahead]
    [0, 90, 90], // facing north, the point due east: to the right
    [270, 90, 0], // facing east (north on the left), the point due east: straight ahead
    [90, 90, 180], // facing west (north on the right), the point due east: behind
    [180, 0, 180], // facing south, the point due north: behind
    [350, 20, 10], // across 360
    [10, 345, 355], // across 0
  ])('heading %s° and bearing %s° point the arrow at %s°', (heading, bearing, expected) => {
    const angle = pointerAngle(derived(heading, METHOD), derived(bearing, METHOD))
    expect(angle.classification).toBe('DERIVED')
    expect(angle.classification === 'DERIVED' && angle.value).toBeCloseTo(expected, 9)
  })

  it('states the bearing method and the heading method', () => {
    const angle = pointerAngle(derived(0, 'fixture-heading'), official(0, 'fixture-bearing'))
    expect(angle.classification === 'DERIVED' && angle.method).toBe(
      'fixture-bearing; turned to the screen by your compass heading (fixture-heading)',
    )
  })

  it('stays SIMULATED when either input is, never laundered into DERIVED', () => {
    expect(pointerAngle(simulated(10, 'fixture'), derived(20, METHOD)).classification).toBe('SIMULATED')
    expect(pointerAngle(derived(10, METHOD), simulated(20, 'fixture')).classification).toBe('SIMULATED')
  })

  it('is UNAVAILABLE with the reason when the heading is', () => {
    expect(pointerAngle(unavailable('fixture-pole'), derived(20, METHOD))).toEqual(
      unavailable('No heading: fixture-pole'),
    )
  })

  it('is UNAVAILABLE with the reason when the bearing is', () => {
    expect(pointerAngle(derived(10, METHOD), unavailable('fixture-same-point'))).toEqual(
      unavailable('No direction to the point: fixture-same-point'),
    )
  })

  it.each([NaN, Infinity])('is UNAVAILABLE for a %s input, never an angle', (value) => {
    expect(pointerAngle(derived(value, METHOD), derived(20, METHOD)).classification).toBe('UNAVAILABLE')
    expect(pointerAngle(derived(10, METHOD), derived(value, METHOD)).classification).toBe('UNAVAILABLE')
  })
})

describe('aimedPoint', () => {
  it('is the stored stop, even one the walker is within reach of: only Next moves on', () => {
    expect(aimedPoint(route(5, 9), 0)).toBe(0)
    expect(aimedPoint(route(0.05, 9), 0)).toBe(0)
    expect(aimedPoint(route(ARRIVAL_KM, 0.02, 7), 0)).toBe(0)
    expect(aimedPoint(route(9, 0.5, 7), 1)).toBe(1)
  })

  it('clamps a stored index that is out of range', () => {
    expect(aimedPoint(route(5, 9), 7)).toBe(1)
    expect(aimedPoint(route(5, 9), -2)).toBe(0)
  })
})

describe('isReached and shownDistance', () => {
  it('reads only a finite, non-negative distance', () => {
    expect(isReached(at(0.05))).toBe(true)
    expect(isReached(at(null))).toBe(false)
    expect(isReached(at(ARRIVAL_KM))).toBe(true)
    expect(isReached(at(ARRIVAL_KM + 0.001))).toBe(false)
    expect(isReached(at(NaN))).toBe(false)
    expect(isReached(at(-0.05))).toBe(false)
    expect(shownDistance(derived(NaN, METHOD)).classification).toBe('UNAVAILABLE')
    expect(shownDistance(derived(-1, METHOD)).classification).toBe('UNAVAILABLE')
    expect(shownDistance(derived(3, METHOD))).toEqual(derived(3, METHOD))
    expect(shownDistance(unavailable('fixture-reason'))).toEqual(unavailable('fixture-reason'))
  })
})

describe('directionText', () => {
  it.each([
    [0, 'Straight ahead'],
    [360, 'Straight ahead'],
    [359.6, 'Straight ahead'],
    [0.4, 'Straight ahead'],
    [180, 'Behind you'],
    [40, '40° to your right'],
    [320, '40° to your left'],
    [-90, '90° to your left'],
  ])('%s° reads "%s"', (deg, text) => {
    expect(directionText(deg)).toBe(text)
  })

  it.each([NaN, Infinity])('is null for %s', (deg) => {
    expect(directionText(deg)).toBeNull()
  })
})

describe('formatWayDistance', () => {
  it.each([
    [0, '0 m'],
    [0.35, '350 m'],
    [0.9994, '999 m'],
    [0.9996, '1.0 km'],
    [12.44, '12.4 km'],
    [99.96, '100 km'],
    [312.4, '312 km'],
    [1234.5, '1,235 km'],
  ])('%s km reads "%s"', (km, text) => {
    expect(formatWayDistance(km)).toBe(text)
  })
})
