import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MISSION_SETTINGS,
  MARS_MEAN_RADIUS_KM,
  derived,
  official,
  SUITED_SLOPE_LIMIT,
  unavailable,
  walkPlanProblem,
  type Classified,
  type MarsCoordinate,
  type MissionSettings,
  type WalkPlan,
} from '../../src/domain'
import { planProfile, type ElevationProfile } from '../../src/features/route-analysis/elevationProfile'
import { walkingKcalPerKm } from '../../src/features/route-analysis/metabolicCost'
import { surfaceDistanceKm } from '../../src/features/route-analysis/routeDistance'
import {
  ENERGY_FIT_CAVEAT,
  fitsSettings,
  maxSamplesThatFit,
  MIN_SAMPLE_SPACING_M,
  placeSamples,
  SAMPLE_MINUTES,
  WALK_BUDGET_REASONS,
  walkBudget,
} from '../../src/features/route-analysis/walkBudget'
import { suitedWalkingKmh } from '../../src/features/route-analysis/walkingSpeed'
import { SAMPLE_MINUTES as SLIDER_SAMPLE_MINUTES } from '../../src/features/mission-ui/walk/missionSettings'

// Test fixtures only: invented paths and heights, never shown in the app.
const KM_PER_DEG = (MARS_MEAN_RADIUS_KM * Math.PI) / 180

/** A path due north from 18.4°N 77.4°E, a sample every `stepKm`, with these heights (NaN = none). */
function profile(heights: number[], stepKm = 0.1): ElevationProfile {
  return {
    totalDistanceKm: stepKm * (heights.length - 1),
    samples: heights.map((h, i) => ({
      coordinate: { latitude: 18.4 + (i * stepKm) / KM_PER_DEG, longitudeEast: 77.4 },
      distanceKm: i * stepKm,
      elevationMeters: (Number.isNaN(h) ? unavailable('fixture: no height') : official(h, 'fixture')) as Classified<number>,
    })),
  }
}
const flat = (n: number, stepKm = 0.1) => profile(Array(n).fill(-2500), stepKm)
const value = (c: Classified<number>) => {
  if (c.classification === 'UNAVAILABLE') throw new Error(c.reason)
  return c.value
}
const settings = (o: Partial<MissionSettings> = {}): MissionSettings => ({ ...DEFAULT_MISSION_SETTINGS, ...o })

describe('walkBudget', () => {
  it('times and costs a known flat walk, 5 min per sample on top', () => {
    const b = walkBudget(flat(11), 4) // 1 km on the level
    expect(value(b.distanceKm)).toBeCloseTo(1, 9)
    expect(value(b.walkingMin)).toBeCloseTo((1 / suitedWalkingKmh(0)) * 60, 9) // 30 min at 2 km/h
    expect(value(b.walkingMin)).toBeCloseTo(30, 9)
    expect(value(b.samplingMin)).toBe(4 * SAMPLE_MINUTES)
    expect(value(b.totalMin)).toBeCloseTo(30 + 20, 9)
    expect(value(b.walkingKcal)).toBeCloseTo(walkingKcalPerKm(0), 9)
    expect(value(b.steepestDeg)).toBe(0)
  })

  it('costs a climb more than the level, by each stretch\'s slope', () => {
    const rise = 0.1 // 10 m per 100 m
    const b = walkBudget(profile([0, 10, 20, 30]), 0)
    expect(value(b.walkingMin)).toBeCloseTo((0.3 / suitedWalkingKmh(rise)) * 60, 9)
    expect(value(b.walkingKcal)).toBeCloseTo(0.3 * walkingKcalPerKm(rise), 9)
    expect(value(b.steepestDeg)).toBeCloseTo((Math.atan(rise) * 180) / Math.PI, 9)
  })

  it('never counts sampling energy: no cited figure', () => {
    const b = walkBudget(flat(3), 6)
    expect(b.samplingKcal).toEqual(unavailable(WALK_BUDGET_REASONS.samplingEnergy))
  })

  it('gives UNAVAILABLE, not zero, where a height is missing', () => {
    const b = walkBudget(profile([0, Number.NaN, 0]), 2)
    for (const f of [b.walkingMin, b.totalMin, b.walkingKcal, b.steepestDeg]) {
      expect(f.classification).toBe('UNAVAILABLE')
    }
    expect(value(b.distanceKm)).toBeCloseTo(0.2, 9)
    expect(value(b.samplingMin)).toBe(10)
  })

  it('gives UNAVAILABLE for a walk with no length', () => {
    expect(walkBudget(flat(1), 1).walkingMin).toEqual(unavailable(WALK_BUDGET_REASONS.tooShort))
  })

  it('names the cited pace and cost, and says neither is a Mars measurement', () => {
    const b = walkBudget(flat(3), 1)
    for (const f of [b.walkingMin, b.walkingKcal, b.totalMin]) {
      if (f.classification !== 'DERIVED') throw new Error('not derived')
      expect(f.method).toMatch(/not a Mars measurement/)
    }
    const m = (c: Classified<number>) => (c.classification === 'DERIVED' ? c.method : '')
    expect(m(b.walkingMin)).toMatch(/Tobler/)
    expect(m(b.walkingMin)).toMatch(/EVA-EXP-0075/)
    expect(m(b.walkingKcal)).toMatch(/Minetti/)
    expect(m(b.samplingMin)).toMatch(/project choice/)
  })

  it('uses the one minutes-per-sample figure the sliders show', () => {
    expect(SLIDER_SAMPLE_MINUTES).toBe(SAMPLE_MINUTES)
    expect(SAMPLE_MINUTES).toBe(5)
  })
})

describe('fitsSettings', () => {
  it('fits a short flat walk', () => {
    expect(fitsSettings(walkBudget(flat(11), 6), settings())).toEqual({ fits: true, breaks: [], unknown: [], energyCaveat: ENERGY_FIT_CAVEAT })
  })

  it('reports each limit broken, by how much', () => {
    const b = walkBudget(flat(11), 6) // 30 + 30 min, ~46 kcal
    const tight = fitsSettings(b, settings({ durationMin: 45, energyKcal: 40 }))
    expect(tight.fits).toBe(false)
    expect(tight.breaks.map((x) => x.limit)).toEqual(['duration', 'energy'])
    expect(tight.breaks[0].over).toBeCloseTo(15, 9)
    expect(tight.breaks[1].over).toBeCloseTo(walkingKcalPerKm(0) - 40, 9)
    expect(tight.breaks[0].method).toContain('5 min per sample')
    expect(tight.breaks[1].method).toContain('Minetti')
  })

  it('reports a stretch over the slope limit', () => {
    const steep = walkBudget(profile([0, 50, 50]), 0) // 50 m in 100 m, ~26.6°
    const fit = fitsSettings(steep, settings({ maxSlopeDeg: 20 }))
    expect(fit.fits).toBe(false)
    expect(fit.breaks).toHaveLength(1)
    expect(fit.breaks[0].limit).toBe('slope')
    expect(fit.breaks[0].over).toBeCloseTo((Math.atan(0.5) * 180) / Math.PI - 20, 9)
  })

  it('cannot say when a figure is UNAVAILABLE, and says which', () => {
    const fit = fitsSettings(walkBudget(profile([0, Number.NaN, 0]), 1), settings())
    expect(fit).toEqual({ fits: null, breaks: [], unknown: ['duration', 'energy', 'slope'], energyCaveat: ENERGY_FIT_CAVEAT })
  })
})

describe('maxSamplesThatFit', () => {
  it('fills the time left after walking with whole samples', () => {
    // 30 min walking in 60 min leaves 6 samples of 5 min.
    expect(value(maxSamplesThatFit(walkBudget(flat(11), 0), settings({ durationMin: 60 })))).toBe(6)
    expect(value(maxSamplesThatFit(walkBudget(flat(11), 0), settings({ durationMin: 64 })))).toBe(6)
  })

  it('fits none when walking alone breaks the time or the energy', () => {
    expect(value(maxSamplesThatFit(walkBudget(flat(11), 0), settings({ durationMin: 20 })))).toBe(0)
    expect(value(maxSamplesThatFit(walkBudget(flat(11), 0), settings({ energyKcal: 10 })))).toBe(0)
  })

  it('is UNAVAILABLE where the walking time is', () => {
    expect(maxSamplesThatFit(walkBudget(profile([0, Number.NaN]), 0), settings()).classification).toBe('UNAVAILABLE')
  })
})

describe('placeSamples', () => {
  const placed = (p: ElevationProfile, n: number, o: Parameters<typeof placeSamples>[2] = { maxSlopeDeg: 20 }) => {
    const r = placeSamples(p, n, o)
    if (r.classification === 'UNAVAILABLE') throw new Error(r.reason)
    return r.value
  }
  const kmAlong = (p: ElevationProfile, c: { latitude: number; longitudeEast: number }) =>
    surfaceDistanceKm(p.samples[0].coordinate, c)

  it('spaces samples evenly by distance, in walking order, 5 min each', () => {
    const p = flat(11) // 1 km
    const { samples, missing } = placed(p, 4)
    expect(missing).toBe(0)
    expect(samples.map((s) => s.order)).toEqual([1, 2, 3, 4])
    expect(samples.every((s) => s.dwellMin === SAMPLE_MINUTES)).toBe(true)
    samples.forEach((s, i) => expect(kmAlong(p, s.coordinate)).toBeCloseTo((i + 1) * 0.2, 6))
  })

  it('never puts two samples closer than the minimum spacing, and says how many did not fit', () => {
    const p = flat(4) // 300 m: room for 4 at 100 m (both ends included), not 6
    const { samples, missing } = placed(p, 6)
    expect(samples.length + missing).toBe(6)
    expect(missing).toBeGreaterThan(0)
    for (let i = 1; i < samples.length; i++) {
      const gap = surfaceDistanceKm(samples[i - 1].coordinate, samples[i].coordinate) * 1000
      expect(gap).toBeGreaterThanOrEqual(MIN_SAMPLE_SPACING_M - 1e-6)
    }
  })

  it('puts no sample on a stretch over the slope limit, moving it to allowed ground', () => {
    // 0–0.4 km flat, 0.4–0.6 km steep (50 m in 100 m), 0.6–1 km flat. Even spacing of 1 aims at 0.5 km.
    const p = profile([0, 0, 0, 0, 0, 50, 100, 100, 100, 100, 100])
    const { samples } = placed(p, 1)
    expect(samples).toHaveLength(1)
    const km = kmAlong(p, samples[0].coordinate)
    expect(km <= 0.4 + 1e-6 || km >= 0.6 - 1e-6).toBe(true)
  })

  it('puts no sample where the height is missing', () => {
    const p = profile([0, 0, 0, 0, Number.NaN, Number.NaN, Number.NaN, 0, 0, 0, 0])
    const { samples } = placed(p, 1)
    const km = kmAlong(p, samples[0].coordinate)
    expect(km <= 0.3 + 1e-6 || km >= 0.7 - 1e-6).toBe(true)
  })

  it('takes the walk\'s own places, dropping one too close or on steep ground', () => {
    const p = profile([0, 0, 0, 0, 0, 50, 100, 100, 100, 100, 100])
    const { samples, missing } = placed(p, 3, { maxSlopeDeg: 20, placesKm: [0.85, 0.2, 0.25, 0.5] })
    expect(samples.map((s) => kmAlong(p, s.coordinate))).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.85, 6)])
    expect(missing).toBe(1)
  })

  it('is UNAVAILABLE when no ground at all is allowed', () => {
    const r = placeSamples(profile([0, 50, 100]), 2, { maxSlopeDeg: 20 })
    expect(r).toEqual(unavailable(WALK_BUDGET_REASONS.noRoom))
  })

  it('places nothing when asked for none', () => {
    expect(placed(flat(5), 0)).toEqual({ samples: [], missing: 0 })
  })
})

describe('the budget and the walk contract together', () => {
  it('says on every fit that the energy checked is the walking only', () => {
    expect(ENERGY_FIT_CAVEAT).toContain('walking only')
    expect(fitsSettings(walkBudget(flat(11), 6), settings()).energyCaveat).toBe(ENERGY_FIT_CAVEAT)
  })

  it('calls the sample time a project choice in every method the app shows', () => {
    const b = walkBudget(flat(11), 6)
    const placed = placeSamples(flat(11), 2, { maxSlopeDeg: 20 })
    const shown = [b.samplingMin, b.totalMin, maxSamplesThatFit(b, settings()), placed].map((c) => (c.classification === 'DERIVED' ? c.method : ''))
    for (const method of shown) {
      expect(method).toContain('a project choice')
    }
  })

  it('has no sampling time for a count that is not a whole number of zero or more', () => {
    for (const bad of [-1, 2.5, Number.NaN]) {
      const b = walkBudget(flat(11), bad)
      expect(b.samplingMin).toEqual({ classification: 'UNAVAILABLE', reason: WALK_BUDGET_REASONS.badCount })
      expect(b.totalMin.classification).toBe('UNAVAILABLE')
      expect(b.walkingMin.classification).toBe('DERIVED')
    }
  })

  it('places samples the walk contract accepts, on a walk with a bend in each leg', () => {
    const at = (latitude: number, longitudeEast: number): MarsCoordinate => ({ latitude, longitudeEast })
    const legPaths = [
      [at(18.44, 77.45), at(18.446, 77.452), at(18.444, 77.46)],
      [at(18.444, 77.46), at(18.438, 77.463), at(18.44, 77.47)],
    ]
    const path = [...legPaths[0], ...legPaths[1].slice(1)]
    const planned = planProfile(path)
    expect(planned.classification).toBe('DERIVED')
    if (planned.classification === 'UNAVAILABLE') return
    const bent: ElevationProfile = {
      totalDistanceKm: planned.value.totalDistanceKm,
      samples: planned.value.points.map((p) => ({ ...p, elevationMeters: official(-2500, 'fixture') })),
    }
    const placed = placeSamples(bent, 6, { maxSlopeDeg: 20 })
    expect(placed.classification).toBe('DERIVED')
    if (placed.classification === 'UNAVAILABLE') return
    expect(placed.value.samples).toHaveLength(6)
    const stop = (id: string, coordinate: MarsCoordinate) => ({
      id,
      label: `Fixture ${id}`,
      coordinate,
      unit: unavailable<never>('fixture'),
      reason: derived('fixture reason', 'fixture method'),
    })
    const leg = (fromStopId: string, toStopId: string, coordinates: MarsCoordinate[]) => ({
      fromStopId,
      toStopId,
      path: derived(coordinates, 'fixture path'),
      distanceKm: unavailable<never>('fixture'),
      steepestSlopeDeg: unavailable<never>('fixture'),
      hazards: unavailable<never>('fixture'),
    })
    const plan: WalkPlan = {
      goal: { id: 'g', label: 'Fixture goal', unitNames: ['Fixture unit'], reason: derived('fixture', 'fixture') },
      stops: [stop('a', path[0]), stop('b', legPaths[0][2]), stop('c', legPaths[1][2])],
      legs: [leg('a', 'b', legPaths[0]), leg('b', 'c', legPaths[1])],
      slopeLimit: SUITED_SLOPE_LIMIT,
      kind: 'flat-bedrock',
      settings: DEFAULT_MISSION_SETTINGS,
      samples: placed.value.samples,
    }
    expect(walkPlanProblem(plan)).toBeNull()
  })
})
