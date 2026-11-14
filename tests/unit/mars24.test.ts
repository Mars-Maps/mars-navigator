import { describe, expect, it } from 'vitest'
import { isAvailable } from '../../src/domain'
import {
  MARS24_METHOD,
  localTrueSolarTimeHours,
  mars24Steps,
  marsSolarTime,
} from '../../src/domain/mars24'

/**
 * Oracle: the worked example on NASA GISS "Mars24 Sunclock — Algorithm and
 * Worked Examples" (page version 2025-01-07), for 2000-01-06 00:00:00 UTC at
 * 0°N 0°. The page prints 5 decimals; we assert to 4 so rounding on the page
 * cannot fail a correct implementation, while any wrong coefficient does.
 */
const GISS_EXAMPLE_UTC = Date.UTC(2000, 0, 6, 0, 0, 0)

describe('mars24Steps — GISS worked example, 2000-01-06 00:00 UTC', () => {
  const s = mars24Steps(GISS_EXAMPLE_UTC)

  it('converts UTC to Julian dates', () => {
    expect(GISS_EXAMPLE_UTC).toBe(947116800000)
    expect(s.jdUt).toBe(2451549.5)
    expect(s.ttMinusUtcSeconds).toBeCloseTo(64.184, 6)
    expect(s.jdTt).toBeCloseTo(2451549.50074, 4)
    expect(s.deltaTJ2000).toBeCloseTo(4.50074, 4)
  })

  it('computes the heliocentric distance (step D-2)', () => {
    // The page prints R_M = 1.39358 AU for this instant.
    expect(s.heliocentricDistanceAu).toBeCloseTo(1.39358, 4)
    expect(marsSolarTime(GISS_EXAMPLE_UTC)).toMatchObject({ value: { heliocentricDistanceAu: s.heliocentricDistanceAu } })
  })

  it('computes orbital angles', () => {
    expect(s.meanAnomalyDeg).toBeCloseTo(21.74558, 4)
    expect(s.fictitiousMeanSunDeg).toBeCloseTo(272.74566, 4)
    expect(s.perturbersDeg).toBeCloseTo(0.00142, 4)
    expect(s.equationOfCenterDeg).toBeCloseTo(4.44193, 4)
    expect(s.solarLongitudeDeg).toBeCloseTo(277.18758, 4)
  })

  it('computes time and sun position', () => {
    expect(s.equationOfTimeDeg).toBeCloseTo(-5.18774, 4)
    expect(s.meanSolarTimeHours).toBeCloseTo(23.99425, 4)
    expect(s.subsolarLongitudeWestDeg).toBeCloseTo(174.726, 4)
    expect(s.solarDeclinationDeg).toBeCloseTo(-25.22825, 4)
  })
})

describe('marsSolarTime', () => {
  it('is DERIVED and states the Mars24 method', () => {
    const r = marsSolarTime(GISS_EXAMPLE_UTC)
    expect(r.classification).toBe('DERIVED')
    if (r.classification !== 'DERIVED') return
    expect(r.method).toBe(MARS24_METHOD)
    expect(r.method).toMatch(/approximation/)
  })

  it('converts the subsolar longitude from °W to the project °E', () => {
    const r = marsSolarTime(GISS_EXAMPLE_UTC)
    if (!isAvailable(r)) throw new Error('expected a value')
    // 174.726°W is 185.274°E.
    expect(r.value.subsolarPoint.longitudeEast).toBeCloseTo(185.274, 4)
    expect(r.value.subsolarPoint.latitude).toBeCloseTo(-25.22825, 4)
  })

  it('local true solar time at 0° matches GISS LTST', () => {
    const r = marsSolarTime(GISS_EXAMPLE_UTC)
    if (!isAvailable(r)) throw new Error('expected a value')
    expect(localTrueSolarTimeHours(r.value, 0)).toBeCloseTo(23.6484, 4)
  })

  it('it is local noon at the subsolar longitude', () => {
    for (const utc of [GISS_EXAMPLE_UTC, Date.UTC(2026, 9, 18, 12), Date.UTC(1965, 6, 15)]) {
      const r = marsSolarTime(utc)
      if (!isAvailable(r)) throw new Error('expected a value')
      const noon = localTrueSolarTimeHours(r.value, r.value.subsolarPoint.longitudeEast)
      expect(noon).toBeCloseTo(12, 6)
    }
  })

  it('is deterministic: the same instant gives the same result', () => {
    const t = Date.UTC(2026, 9, 28, 6, 30)
    expect(marsSolarTime(t)).toEqual(marsSolarTime(t))
  })

  it('moves the sun westward as time advances, about 360° per sol', () => {
    const t = Date.UTC(2026, 9, 18)
    const a = marsSolarTime(t)
    const b = marsSolarTime(t + 3_600_000)
    if (!isAvailable(a) || !isAvailable(b)) throw new Error('expected values')
    // One Earth hour is 1/1.0274912517 of a Mars hour: 14.6° of rotation.
    const westward = (a.value.subsolarPoint.longitudeEast - b.value.subsolarPoint.longitudeEast + 360) % 360
    expect(westward).toBeGreaterThan(14.5)
    expect(westward).toBeLessThan(14.7)
  })

  it('keeps output in range', () => {
    for (let day = 0; day < 700; day += 7) {
      const r = marsSolarTime(Date.UTC(2026, 0, 1) + day * 86_400_000)
      if (!isAvailable(r)) throw new Error('expected a value')
      const v = r.value
      expect(v.subsolarPoint.longitudeEast).toBeGreaterThanOrEqual(0)
      expect(v.subsolarPoint.longitudeEast).toBeLessThan(360)
      // Mars obliquity is about 25.2°, so the sun never goes further.
      expect(Math.abs(v.subsolarPoint.latitude)).toBeLessThan(25.5)
      expect(v.solarLongitudeDeg).toBeGreaterThanOrEqual(0)
      expect(v.solarLongitudeDeg).toBeLessThan(360)
      expect(v.coordinatedMarsTimeHours).toBeGreaterThanOrEqual(0)
      expect(v.coordinatedMarsTimeHours).toBeLessThan(24)
    }
  })

  it('is UNAVAILABLE for an invalid instant, never a guessed value', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = marsSolarTime(bad)
      expect(r.classification).toBe('UNAVAILABLE')
    }
  })
})
