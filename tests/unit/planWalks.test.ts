import { describe, expect, it } from 'vitest'
import { joinSentences, noWalkReason, plannedWalks, planWalks, slopeLimitOf, steepestLeg, type DraftWalk, type WalksPlanner } from '../../src/app/planWalks'
import { sampleProfile, type ProfileHeights } from '../../src/app/routeProfile'
import { createWalkPlanner, type WalkPlannerSources } from '../../src/app/walkPlanner'
import type { HeightModel } from '../../src/data/adapters/LayeredElevation'
import {
  DEFAULT_MISSION_SETTINGS,
  MARS_MEAN_RADIUS_KM,
  SUITED_SLOPE_LIMIT,
  WALK_KINDS,
  derived,
  official,
  unavailable,
  type GeologicFeatures,
  type GeologicMap,
  type GeologicUnit,
  type MarsCoordinate,
  type MissionSettings,
  type WalkKind,
  type WalkStop,
} from '../../src/domain'
import { SAMPLE_MINUTES } from '../../src/features/route-analysis/walkBudget'
import { SCIENCE_GOALS } from '../../src/features/route-analysis/scienceGoals'

// Test fixtures only: an invented map and flat or sloping heights near Jezero.
const JEZERO: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const MAP: GeologicMap = { id: 'SIM 3464', title: 'Fixture map', scaleDenominator: 75000, citation: 'Fixture citation' }
const SITE = { name: 'Fixture crater', map: MAP, bounds: { west: 77, east: 78, south: 18, north: 19 } }
const RAD = Math.PI / 180
const KM_PER_DEG_LAT = MARS_MEAN_RADIUS_KM * RAD
const KM_PER_DEG_LON = KM_PER_DEG_LAT * Math.cos(JEZERO.latitude * RAD)
/** `x` km east and `y` km north of the landing site. */
const at = (x: number, y = 0): MarsCoordinate => ({
  latitude: JEZERO.latitude + y / KM_PER_DEG_LAT,
  longitudeEast: JEZERO.longitudeEast + x / KM_PER_DEG_LON,
})
const FLOOR = SCIENCE_GOALS.find((g) => g.id === 'crater-floor')!
const unit = (name: string): GeologicUnit => ({ symbol: 'fx', name, map: MAP })
const stop = (id: string, coordinate: MarsCoordinate): WalkStop => ({
  id,
  label: id,
  coordinate,
  unit: official(unit(FLOOR.unitNames[0]), 'Fixture citation'),
  reason: derived('fixture', 'fixture'),
})
const signal = () => new AbortController().signal

/** Heights east of the landing site: flat, or rising `grade` metres per metre. */
const heightsOf = (grade = 0) => (points: Float64Array) => {
  const n = points.length / 2
  const h = new Float32Array(n)
  for (let i = 0; i < n; i++) h[i] = -2500 + grade * (points[i * 2 + 1] - JEZERO.longitudeEast) * KM_PER_DEG_LON * 1000
  return h
}
const MODEL: HeightModel = { cellKm: 0.02, label: 'fixture CTX', source: 'fixture CTX', site: true }

function walkSources(grade = 0, over: Partial<WalkPlannerSources> = {}): WalkPlannerSources {
  return {
    site: SITE,
    units: async () => official([], 'Fixture citation'),
    unitAt: async () => official(unit(FLOOR.unitNames[0]), 'Fixture citation'),
    features: async () => official<GeologicFeatures>({ points: [], lines: [], areas: [] }, 'Fixture citation'),
    heights: async (points) => {
      const heights = heightsOf(grade)(points)
      return official({ heights, model: new Uint8Array(heights.length), models: [MODEL] }, 'fixture chain')
    },
    cellKmAlong: () => 0.02,
    traverse: async () => unavailable('fixture: no rover'),
    ...over,
  }
}

function profileHeights(grade = 0): ProfileHeights {
  return {
    elevationsAt: async (points) => {
      const heights = heightsOf(grade)(points)
      return official({ heights, sourceIndex: new Uint8Array(heights.length), sources: [MODEL] }, 'fixture chain')
    },
    description: 'fixture heights',
    noDataReason: 'fixture: no height',
    cellKmAlong: () => 0.02,
  }
}

/** A straight walk `km` east, in two legs; the other two kinds say they are not built. */
const eastward =
  (km: number): DraftWalk =>
  async (start) =>
    derived({ goal: FLOOR, stops: [stop('s0', start), stop('s1', at(km / 2)), stop('s2', at(km))] }, 'fixture')
const notBuilt: DraftWalk = async () => unavailable('fixture: not built')

function planner(
  drafts: Partial<Record<WalkKind, DraftWalk>> = {},
  grade = 0,
  over: Partial<WalkPlannerSources> = {},
): WalksPlanner {
  const legs = createWalkPlanner(walkSources(grade, over))
  return {
    drafts: { 'flat-bedrock': eastward(2), 'rim-to-floor': notBuilt, 'rover-check': notBuilt, ...drafts },
    walkLegs: legs.walkLegs,
    profile: (path, s) => sampleProfile(path, profileHeights(grade), s),
  }
}

async function run(p: WalksPlanner, settings: MissionSettings = DEFAULT_MISSION_SETTINGS, s = signal()) {
  const out = await planWalks(p, JEZERO, settings, s)
  if (out === 'aborted') throw new Error('aborted')
  return out
}

describe('planWalks', () => {
  it('answers for every kind, in the contract’s order, one failing never failing the others', async () => {
    const out = await run(planner())
    expect(out.map((o) => o.kind)).toEqual([...WALK_KINDS])
    expect(out.map((o) => o.status)).toEqual(['planned', 'unavailable', 'unavailable'])
    expect(out[1]).toMatchObject({ status: 'unavailable', reason: 'fixture: not built' })
    expect(plannedWalks(out).map((w) => w.kind)).toEqual(['flat-bedrock'])
  })

  it('makes a plan the contract accepts, with its kind, settings and samples on the path', async () => {
    const [w] = plannedWalks(await run(planner()))
    expect(w.plan).toMatchObject({ kind: 'flat-bedrock', settings: DEFAULT_MISSION_SETTINGS, slopeLimit: SUITED_SLOPE_LIMIT })
    expect(w.plan.samples).toHaveLength(DEFAULT_MISSION_SETTINGS.samples)
    expect(w.plan.samples!.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6])
    expect(w.plan.samples!.every((s) => s.dwellMin === SAMPLE_MINUTES)).toBe(true)
    expect(w.samplesNote).toBeNull()
    expect(w.plan.legs).toHaveLength(2)
  })

  it('counts 5 min per sample in the walk’s time, and checks it against the settings', async () => {
    const [w] = plannedWalks(await run(planner()))
    const { walkingMin, samplingMin, totalMin } = w.budget
    if (walkingMin.classification === 'UNAVAILABLE' || totalMin.classification === 'UNAVAILABLE') throw new Error('no time')
    expect(samplingMin).toMatchObject({ value: DEFAULT_MISSION_SETTINGS.samples * SAMPLE_MINUTES })
    expect(totalMin.value).toBeCloseTo(walkingMin.value + DEFAULT_MISSION_SETTINGS.samples * SAMPLE_MINUTES, 6)
    expect(w.fit).toMatchObject({ fits: true, breaks: [] })
  })

  it('places only as many samples as the duration leaves time for, and says so', async () => {
    // Walking 2 km takes most of a 45 min duration, leaving time for only a few of the 6 samples.
    const tight = { ...DEFAULT_MISSION_SETTINGS, durationMin: 45 }
    const [w] = plannedWalks(await run(planner(), tight))
    expect(w.plan.samples!.length).toBeLessThan(tight.samples)
    expect(w.samplesNote).toMatch(/^The walking leaves time for \d of the 6 samples within 45 min\.$/)
  })

  it('walks the legs at the settings’ slope, and says where the walk breaks it', async () => {
    const settings = { ...DEFAULT_MISSION_SETTINGS, maxSlopeDeg: 5 }
    const [w] = plannedWalks(await run(planner({}, 0.2), settings)) // about 11° all the way
    expect(w.plan.slopeLimit.deg).toBe(5)
    expect(w.plan.legs[0].steepestSlopeDeg).toMatchObject({ classification: 'DERIVED' })
    expect(w.fit.fits).toBe(false)
    expect(w.fit.breaks.map((b) => b.limit)).toContain('slope')
    // The walk's slope is its legs' own figure, the one their flags show.
    expect(w.budget.steepestDeg).toEqual(steepestLeg(w.plan.legs))
    // No ground within 5°, so no sample has room, and the walk says why.
    expect(w.plan.samples).toEqual([])
    expect(w.samplesNote).toMatch(/No ground on the walk/)
  })

  it('says energy, not time, when the walking alone is over the energy budget', async () => {
    const [w] = plannedWalks(await run(planner(), { ...DEFAULT_MISSION_SETTINGS, energyKcal: 10 }))
    expect(w.plan.samples).toEqual([])
    expect(w.samplesNote).toBe('The walking alone is over the 10 kcal energy budget, so no samples fit.')
    expect(w.fit.breaks.map((b) => b.limit)).toContain('energy')
  })

  it('gives a walk’s reason when its stops, its heights or its planner fail', async () => {
    const throws: DraftWalk = async () => {
      throw new Error('fixture failure')
    }
    const out = await run(planner({ 'flat-bedrock': throws, 'rim-to-floor': eastward(1) }))
    expect(out[0]).toEqual({ kind: 'flat-bedrock', status: 'unavailable', reason: 'The planner failed: fixture failure' })
    expect(out[1].status).toBe('planned')

    const noHeights: WalksPlanner = { ...planner(), profile: async () => unavailable('fixture: no heights') }
    expect((await run(noHeights))[0]).toMatchObject({
      status: 'unavailable',
      reason: 'The heights along the walk could not be read: fixture: no heights',
    })
  })

  it('refuses a plan that breaks the contract, with the contract’s reason', async () => {
    const noLegs: WalksPlanner = { ...planner(), walkLegs: async () => [] }
    expect((await run(noLegs))[0]).toEqual({ kind: 'flat-bedrock', status: 'unavailable', reason: '3 stops need 2 legs, not 0' })
  })

  it('comes back aborted once cancelled, whatever the walks did', async () => {
    const c = new AbortController()
    c.abort()
    expect(await planWalks(planner(), JEZERO, DEFAULT_MISSION_SETTINGS, c.signal)).toBe('aborted')
    const c2 = new AbortController()
    const midway: DraftWalk = async () => {
      c2.abort()
      return unavailable('Cancelled')
    }
    expect(await planWalks(planner({ 'rover-check': midway }), JEZERO, DEFAULT_MISSION_SETTINGS, c2.signal)).toBe('aborted')
  })

  it('comes back aborted when cancelled during the legs, or when a source says Cancelled', async () => {
    const c = new AbortController()
    const midLegs: WalksPlanner = {
      ...planner(),
      walkLegs: async () => {
        c.abort()
        throw new DOMException('Cancelled', 'AbortError')
      },
    }
    expect(await planWalks(midLegs, JEZERO, DEFAULT_MISSION_SETTINGS, c.signal)).toBe('aborted')
    const c2 = new AbortController()
    const cancelledProfile: WalksPlanner = {
      ...planner(),
      profile: async () => {
        c2.abort()
        return unavailable('Cancelled')
      },
    }
    expect(await planWalks(cancelledProfile, JEZERO, DEFAULT_MISSION_SETTINGS, c2.signal)).toBe('aborted')
  })

  it('takes a walk’s own samples as they are, and puts its notes after the shell’s', async () => {
    const own: DraftWalk = async (start) => {
      const stops = [stop('s0', start), stop('s1', at(1)), stop('s2', at(2))]
      const samples = [1, 2].map((x, i) => ({ id: `own-${i + 1}`, order: i + 1, coordinate: at(x), dwellMin: SAMPLE_MINUTES }))
      return derived({ goal: FLOOR, stops, samples, notes: ['fixture note.'] }, 'fixture')
    }
    const [w] = plannedWalks(await run(planner({ 'flat-bedrock': own })))
    expect(w.plan.samples!.map((s) => s.id)).toEqual(['own-1', 'own-2'])
    expect(w.budget.samplingMin).toMatchObject({ value: 2 * SAMPLE_MINUTES })
    expect(w.samplesNote).toBe('fixture note.')
  })

  it('numbers each walk’s reason when none could be planned', async () => {
    const out = await run(planner({ 'flat-bedrock': notBuilt }))
    expect(plannedWalks(out)).toEqual([])
    expect(noWalkReason(out)).toBe('walk 1: fixture: not built; walk 2: fixture: not built; walk 3: fixture: not built')
  })
})

describe('steepestLeg', () => {
  it('takes the steepest leg, and is UNAVAILABLE when a leg’s slope is unknown rather than reading it as flat', async () => {
    const [w] = plannedWalks(await run(planner({}, 0.1)))
    const steepest = steepestLeg(w.plan.legs)
    expect(steepest.classification).toBe('DERIVED')
    if (steepest.classification !== 'DERIVED') return
    expect(steepest.value).toBeCloseTo(Math.atan(0.1) * (180 / Math.PI), 0)
    const unknown = { ...w.plan.legs[0], steepestSlopeDeg: unavailable<number>('fixture: no heights'), hazards: unavailable<never[]>('fixture') }
    expect(steepestLeg([unknown, w.plan.legs[1]])).toMatchObject({ classification: 'UNAVAILABLE' })
  })
})

describe('joinSentences', () => {
  it('ends each part with a full stop and skips the empty ones', () => {
    expect(joinSentences(['One', null, ' ', 'Two.', 'Three?'])).toBe('One. Two. Three?')
    expect(joinSentences([null])).toBeNull()
  })
})

describe('slopeLimitOf', () => {
  it('keeps the cited figure cited, and calls any other value the settings’ own', () => {
    expect(slopeLimitOf(DEFAULT_MISSION_SETTINGS)).toBe(SUITED_SLOPE_LIMIT)
    const own = slopeLimitOf({ ...DEFAULT_MISSION_SETTINGS, maxSlopeDeg: 15 })
    expect(own.deg).toBe(15)
    expect(own.label).toBe('set in the mission settings, not a cited figure')
    expect(own.source).toContain(SUITED_SLOPE_LIMIT.source)
  })
})

describe('planWalks: a walk that returns must return within the settings', () => {
  /** Out east to 1, 2 and 3 km and back to the landing site: 6 km in all. */
  const outAndBack: DraftWalk = async (start) =>
    derived(
      { goal: FLOOR, stops: [stop('s0', start), stop('s1', at(1)), stop('s2', at(2)), stop('s3', at(3)), stop('back', start)] },
      'fixture',
    )

  it('leaves the farthest stop off when the whole walk, way back included, is over the time', async () => {
    // 6 km is 180 min of walking, over 160; without the farthest stop it is 4 km, 120 min, and the samples fit too.
    const [walk] = plannedWalks(await run(planner({ 'flat-bedrock': outAndBack }), { ...DEFAULT_MISSION_SETTINGS, durationMin: 160 }))
    expect(walk.plan.stops.map((s) => s.id)).toEqual(['s0', 's1', 's2', 'back'])
    expect(walk.plan.legs).toHaveLength(3)
    expect(walk.plan.legs[2].toStopId).toBe('back')
    expect(walk.fit.fits).toBe(true)
    expect(walk.budget.totalMin).toMatchObject({ classification: 'DERIVED' })
    expect(walk.samplesNote).toContain('1 stop was left off')
  })

  it('keeps every stop when the walk and the way back fit', async () => {
    const [walk] = plannedWalks(await run(planner({ 'flat-bedrock': outAndBack })))
    expect(walk.plan.stops.map((s) => s.id)).toEqual(['s0', 's1', 's2', 's3', 'back'])
    expect(walk.fit.fits).toBe(true)
    expect(walk.samplesNote ?? '').not.toContain('left off')
  })
})

describe('planWalks: the samples of a walk that comes back (review of the return leg)', () => {
  const xKm = (c: MarsCoordinate) => (c.longitudeEast - JEZERO.longitudeEast) * KM_PER_DEG_LON
  /** Out 1.05 km east and straight back, with no places of its own: the shell spaces the samples. */
  const thereAndBack: DraftWalk = async (start) =>
    derived({ goal: FLOOR, stops: [stop('s0', start), stop('s1', at(1.05)), stop('back', start)] }, 'fixture')

  it('samples the way out only: six places, none twice, none on the way back', async () => {
    const [walk] = plannedWalks(await run(planner({ 'flat-bedrock': thereAndBack })))
    const xs = (walk.plan.samples ?? []).map((s) => xKm(s.coordinate))
    expect(xs).toHaveLength(6)
    // In walking order they only go out: a sample on the way back would come nearer the start again.
    expect([...xs].sort((a, b) => a - b)).toEqual(xs)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThan(0.099)
    expect(xs[xs.length - 1]).toBeLessThanOrEqual(1.05 + 1e-6)
  })

  it('keeps the samples of a longer out-and-back walk apart on the ground too', async () => {
    const outAndBack: DraftWalk = async (start) =>
      derived({ goal: FLOOR, stops: [stop('s0', start), stop('s1', at(1)), stop('s2', at(2)), stop('s3', at(3)), stop('back', start)] }, 'fixture')
    const [walk] = plannedWalks(await run(planner({ 'flat-bedrock': outAndBack })))
    const xs = (walk.plan.samples ?? []).map((s) => xKm(s.coordinate))
    expect(xs.length).toBeGreaterThan(1)
    expect(new Set(xs.map((x) => x.toFixed(3))).size).toBe(xs.length)
    expect(Math.max(...xs)).toBeLessThanOrEqual(3 + 1e-6)
  })

  it('spreads the samples again over the walk that is left when a stop is left off', async () => {
    // The walk's own places: six, evenly over the way out, as the flat bedrock walk spreads them over the floor.
    const outKm = (path: readonly MarsCoordinate[]) => xKm(path[path.length - 1])
    const placesFor = (path: readonly MarsCoordinate[]) => Array.from({ length: 6 }, (_, i) => (outKm(path) * (i + 1)) / 7)
    const draft: DraftWalk = async (start) => {
      const stops = [stop('s0', start), stop('s1', at(1)), stop('s2', at(2)), stop('s3', at(3)), stop('back', start)]
      return derived({ goal: FLOOR, stops, placesKm: placesFor(stops.slice(0, -1).map((s) => s.coordinate)), placesFor }, 'fixture')
    }
    // 6 km is 180 min of walking, over 160; without the last stop it is 4 km, 120 min, and six samples fit.
    const [walk] = plannedWalks(await run(planner({ 'flat-bedrock': draft }), { ...DEFAULT_MISSION_SETTINGS, durationMin: 160 }))
    expect(walk.plan.stops.map((s) => s.id)).toEqual(['s0', 's1', 's2', 'back'])
    const xs = (walk.plan.samples ?? []).map((s) => xKm(s.coordinate))
    // All six, over the 2 km still walked out: cutting the first walk's places to it would leave four.
    expect(xs).toHaveLength(6)
    expect(Math.max(...xs)).toBeLessThanOrEqual(2 + 1e-6)
    expect(walk.samplesNote).toContain('1 stop was left off')
    expect(walk.samplesNote).not.toContain('found no room')
  })
})
