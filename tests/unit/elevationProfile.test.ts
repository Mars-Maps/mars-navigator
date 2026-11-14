import { describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM, official, unavailable, type MarsCoordinate } from '../../src/domain'
import {
  ELEVATION_PROFILE_REASONS,
  PROFILE_MAX_SAMPLES,
  planProfile,
  pointAlong,
  profileFromHeights,
  profilePointPairs,
  type ProfilePlan,
} from '../../src/features/route-analysis/elevationProfile'

/** Builds a path from [latitude, longitudeEast] pairs. Test fixture only. */
function path(...coords: [number, number][]): MarsCoordinate[] {
  return coords.map(([latitude, longitudeEast]) => ({ latitude, longitudeEast }))
}

const DEG_KM = (Math.PI / 180) * MARS_MEAN_RADIUS_KM
const planOf = (p: MarsCoordinate[], options = {}): ProfilePlan => {
  const plan = planProfile(p, options)
  if (plan.classification !== 'DERIVED') throw new Error(`plan is ${plan.classification}`)
  return plan.value
}

describe('planProfile geometry', () => {
  it('is UNAVAILABLE for an empty path, with a reason', () => {
    expect(planProfile([])).toEqual({ classification: 'UNAVAILABLE', reason: ELEVATION_PROFILE_REASONS.empty })
  })

  it('is UNAVAILABLE for a single point', () => {
    expect(planProfile(path([4.5, 137.4]))).toEqual({
      classification: 'UNAVAILABLE',
      reason: ELEVATION_PROFILE_REASONS.singlePoint,
    })
  })

  it('is UNAVAILABLE for a path whose points are all identical, and treats 0°E and 360°E as one point', () => {
    expect(planProfile(path([4.5, 137.4], [4.5, 137.4], [4.5, 137.4]))).toEqual({
      classification: 'UNAVAILABLE',
      reason: ELEVATION_PROFILE_REASONS.zeroLength,
    })
    expect(planProfile(path([0, 0], [0, 360]))).toEqual({
      classification: 'UNAVAILABLE',
      reason: ELEVATION_PROFILE_REASONS.zeroLength,
    })
  })

  it('refuses an antipodal leg, which has no single great-circle line', () => {
    expect(planProfile(path([0, 0], [0, 180]))).toEqual({
      classification: 'UNAVAILABLE',
      reason: ELEVATION_PROFILE_REASONS.antipodal,
    })
    expect(planProfile(path([90, 0], [-90, 0]))).toMatchObject({ classification: 'UNAVAILABLE' })
  })

  it('accepts consecutive duplicates in an otherwise valid path, adding no sample for them', () => {
    const plan = planOf(path([0, 10], [0, 10], [1, 11]))
    expect(plan.points[0].coordinate).toEqual({ latitude: 0, longitudeEast: 10 })
    expect(plan.points.at(-1)?.coordinate).toEqual({ latitude: 1, longitudeEast: 11 })
    expect(plan.points.filter((p) => p.distanceKm === 0)).toHaveLength(1)
  })

  it('gives every case a distinct, non-empty reason', () => {
    const reasons = Object.values(ELEVATION_PROFILE_REASONS)
    expect(new Set(reasons).size).toBe(reasons.length)
    for (const r of reasons) expect(r.length).toBeGreaterThan(0)
  })
})

describe('planProfile sampling', () => {
  it('samples about one cell apart, capped at the maximum, distances never decreasing', () => {
    // 1.8° on the equator is about 106 km: 532 cells of 200 m, capped at 200 samples.
    const plan = planOf(path([0, 0], [0, 1.8]), { minSpacingKm: 0.2 })
    expect(plan.points).toHaveLength(PROFILE_MAX_SAMPLES)
    expect(plan.totalDistanceKm).toBeCloseTo(1.8 * DEG_KM, 6)
    expect(plan.spacingKm).toBeCloseTo(plan.totalDistanceKm / (PROFILE_MAX_SAMPLES - 1), 9)
    expect(plan.points[0].distanceKm).toBe(0)
    expect(plan.points.at(-1)?.distanceKm).toBeCloseTo(plan.totalDistanceKm, 9)
    for (let i = 1; i < plan.points.length; i++) {
      expect(plan.points[i].distanceKm).toBeGreaterThan(plan.points[i - 1].distanceKm)
    }
    // Samples lie on the equator between the ends, in order.
    const lons = plan.points.map((p) => p.coordinate.longitudeEast)
    expect(Math.max(...plan.points.map((p) => Math.abs(p.coordinate.latitude)))).toBeLessThan(1e-9)
    expect(lons[100]).toBeGreaterThan(lons[99])
  })

  it('takes fewer samples for a short line, never finer than a cell, and never fewer than two', () => {
    // 0.5 km at 200 m cells: three samples.
    const short = planOf(path([0, 0], [0, 0.5 / DEG_KM]), { minSpacingKm: 0.2 })
    expect(short.points).toHaveLength(3)
    const tiny = planOf(path([0, 0], [0, 0.01 / DEG_KM]), { minSpacingKm: 0.2 })
    expect(tiny.points).toHaveLength(2)
    expect(planOf(path([0, 0], [0, 10]), { maxSamples: 1 }).points).toHaveLength(2)
  })

  it('includes every waypoint as a sample at its own distance', () => {
    const plan = planOf(path([0, 0], [0, 1], [1, 1]), { minSpacingKm: 0.2 })
    const corner = plan.points.find((p) => p.coordinate.latitude === 0 && p.coordinate.longitudeEast === 1)
    expect(corner).toBeDefined()
    expect(corner?.distanceKm).toBeCloseTo(DEG_KM, 6)
    expect(plan.points.at(-1)?.coordinate).toEqual({ latitude: 1, longitudeEast: 1 })
  })

  it('states the count and spacing in its method', () => {
    const plan = planProfile(path([0, 0], [0, 1.8]), { minSpacingKm: 0.2 })
    expect(plan.classification).toBe('DERIVED')
    if (plan.classification === 'DERIVED') {
      expect(plan.method).toMatch(/^200 samples about every 535 m along the great-circle legs/)
    }
    const long = planProfile(path([0, 0], [0, 90]), { minSpacingKm: 0.2 })
    if (long.classification === 'DERIVED') expect(long.method).toMatch(/every 27 km/)
  })

  it('flattens the plan to (latitude, longitude) pairs', () => {
    const plan = planOf(path([0, 10], [0, 11]), { maxSamples: 3 })
    expect(Array.from(profilePointPairs(plan))).toEqual([0, 10, 0, 10.5, 0, 11])
  })
})

describe('pointAlong', () => {
  it('is the start at 0, the end at 1 and the midpoint of the shorter arc at 0.5', () => {
    expect(pointAlong({ latitude: 0, longitudeEast: 0 }, { latitude: 0, longitudeEast: 90 }, 0)).toEqual({
      latitude: 0,
      longitudeEast: 0,
    })
    const end = pointAlong({ latitude: 0, longitudeEast: 0 }, { latitude: 0, longitudeEast: 90 }, 1)
    expect(end.latitude).toBeCloseTo(0, 9)
    expect(end.longitudeEast).toBeCloseTo(90, 9)
    const mid = pointAlong({ latitude: 0, longitudeEast: 0 }, { latitude: 0, longitudeEast: 90 }, 0.5)
    expect(mid.latitude).toBeCloseTo(0, 9)
    expect(mid.longitudeEast).toBeCloseTo(45, 9)
    const up = pointAlong({ latitude: 0, longitudeEast: 0 }, { latitude: 90, longitudeEast: 0 }, 0.5)
    expect(up.latitude).toBeCloseTo(45, 9)
  })

  it('crosses the 0°E seam the short way and reports longitudes in [0, 360)', () => {
    const mid = pointAlong({ latitude: 0, longitudeEast: 350 }, { latitude: 0, longitudeEast: 10 }, 0.5)
    expect(mid.longitudeEast).toBeCloseTo(0, 9)
    expect(Object.is(mid.longitudeEast, -0)).toBe(false)
    const quarter = pointAlong({ latitude: 0, longitudeEast: 350 }, { latitude: 0, longitudeEast: 10 }, 0.25)
    expect(quarter.longitudeEast).toBeCloseTo(355, 9)
  })

  it('returns the start for two equal points', () => {
    expect(pointAlong({ latitude: 5, longitudeEast: 360 }, { latitude: 5, longitudeEast: 0 }, 0.5)).toEqual({
      latitude: 5,
      longitudeEast: 0,
    })
  })
})

describe('profileFromHeights', () => {
  const provenance = { source: 'fixture cell source', noDataReason: 'fixture no-data' }
  const plan = planProfile(path([0, 10], [0, 11]), { maxSamples: 3 })

  it('pairs each height with its sample as OFFICIAL, and a NaN as an UNAVAILABLE gap', () => {
    const profile = profileFromHeights(plan, official(new Float32Array([-1200, Number.NaN, 300]), 'cells'), provenance)
    expect(profile.classification).toBe('DERIVED')
    if (profile.classification !== 'DERIVED') return
    expect(profile.value.samples.map((s) => s.elevationMeters)).toEqual([
      official(-1200, 'fixture cell source'),
      unavailable('fixture no-data'),
      official(300, 'fixture cell source'),
    ])
    expect(profile.value.samples.map((s) => s.distanceKm)).toEqual([0, profile.value.totalDistanceKm / 2, profile.value.totalDistanceKm])
    expect(profile.value.totalDistanceKm).toBeCloseTo(DEG_KM, 6)
    expect(profile.method).toMatch(/^3 samples about every .* along the great-circle legs .*; each height is the fixture cell source$/)
  })

  it('passes an UNAVAILABLE plan or read through with its reason', () => {
    expect(profileFromHeights(planProfile([]), official(new Float32Array(0), 'cells'), provenance)).toEqual({
      classification: 'UNAVAILABLE',
      reason: ELEVATION_PROFILE_REASONS.empty,
    })
    expect(profileFromHeights(plan, unavailable('The server answered 503'), provenance)).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'The server answered 503',
    })
  })

  it('refuses a read of the wrong length rather than misaligning samples', () => {
    const profile = profileFromHeights(plan, official(new Float32Array([1, 2]), 'cells'), provenance)
    expect(profile).toMatchObject({ classification: 'UNAVAILABLE', reason: expect.stringMatching(/2 heights for 3 samples/) })
  })
})
