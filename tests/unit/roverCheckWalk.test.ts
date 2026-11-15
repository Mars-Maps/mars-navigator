import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MISSION_SETTINGS,
  MARS_MEAN_RADIUS_KM,
  official,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type MissionSettings,
  type RoverTraverse,
  type TraversePoint,
} from '../../src/domain'
import { planProfile, profileFromHeights, type ElevationProfile } from '../../src/features/route-analysis/elevationProfile'
import { distanceToPathKm } from '../../src/features/route-analysis/provenGround'
import {
  fitRoverCheck,
  ROVER_CHECK_NO_RETURN,
  ROVER_CHECK_REASONS,
  roverCheckPath,
  roverCheckReturnPaths,
  roverCheckStops,
  type RoverCheckCandidate,
} from '../../src/features/route-analysis/roverCheckWalk'
import { surfaceDistanceKm } from '../../src/features/route-analysis/routeDistance'
import { SAMPLE_MINUTES } from '../../src/features/route-analysis/walkBudget'

// Test fixtures only: an invented traverse and heights, never shown in the app.
const KM_PER_DEG = (MARS_MEAN_RADIUS_KM * Math.PI) / 180
const START: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.4 }
/** `km` north (negative: south) of the start. */
const north = (km: number): MarsCoordinate => ({ latitude: START.latitude + km / KM_PER_DEG, longitudeEast: START.longitudeEast })

let solCounter = 100
const waypoint = (c: MarsCoordinate): TraversePoint => {
  const sol = solCounter++
  return { coordinate: c, sol, rmc: { site: 3, drive: sol * 2 }, elevationMeters: official(-2500, 'fixture'), tiltDegrees: unavailable('fixture') }
}
const traverse = (points: TraversePoint[], rover: RoverTraverse['rover'] = 'perseverance'): Classified<RoverTraverse> =>
  official({ rover, source: 'fixture traverse', retrievedUtcMs: 0, points }, 'fixture traverse')

// Waypoints north of the start at 0.3, 0.6, 1.0 and 1.5 km; one at 50 m (on the landing site), one 20 m from
// the 0.6 km one (closer than the spacing), and one 8 km off (out of reach).
const W = [0.3, 0.6, 1.0, 1.5].map((km) => waypoint(north(km)))
const EXTRA = [waypoint(north(0.05)), waypoint(north(0.62)), waypoint(north(8))]
const TRAVERSE = traverse([W[2], EXTRA[0], W[0], EXTRA[2], W[3], EXTRA[1], W[1]])

const settings = (o: Partial<MissionSettings> = {}): MissionSettings => ({ ...DEFAULT_MISSION_SETTINGS, ...o })
function candidate(t = TRAVERSE, s = settings()): RoverCheckCandidate {
  const c = roverCheckStops(START, t, s)
  if (c.classification === 'UNAVAILABLE') throw new Error(c.reason)
  return c.value
}
/** The profile along the candidate's path, as the shell reads it: `height(km along)` metres, NaN for none. */
function profileFor(c: RoverCheckCandidate, height: (km: number) => number = () => -2500): ElevationProfile {
  const plan = planProfile(roverCheckPath(c), { minSpacingKm: 0.05 })
  if (plan.classification === 'UNAVAILABLE') throw new Error(plan.reason)
  const heights = Float32Array.from(plan.value.points, (p) => height(p.distanceKm))
  const profile = profileFromHeights(plan, official(heights, 'fixture'), { source: 'fixture model', noDataReason: 'fixture: no height' })
  if (profile.classification === 'UNAVAILABLE') throw new Error(profile.reason)
  return profile.value
}
/** The profiles along the ways back, one per stop, as the shell reads them: `height(stop number from 1, km along)` metres. */
function returnsFor(c: RoverCheckCandidate, height: (stop: number, km: number) => number = () => -2500): ElevationProfile[] {
  return roverCheckReturnPaths(c).map((path, i) => {
    const plan = planProfile(path, { minSpacingKm: 0.05 })
    if (plan.classification === 'UNAVAILABLE') throw new Error(plan.reason)
    const heights = Float32Array.from(plan.value.points, (p) => height(i + 1, p.distanceKm))
    const profile = profileFromHeights(plan, official(heights, 'fixture'), { source: 'fixture model', noDataReason: 'fixture: no height' })
    if (profile.classification === 'UNAVAILABLE') throw new Error(profile.reason)
    return profile.value
  })
}
const kmFromStart = (c: MarsCoordinate) => surfaceDistanceKm(START, c)

describe('roverCheckStops', () => {
  it('stops at real waypoints, nearest first, skipping the landing site, crowded and out-of-reach ones', () => {
    const c = candidate()
    expect(c.stops.map((s) => s.waypoint)).toEqual(W)
    expect(c.stops.map((s) => kmFromStart(s.coordinate))).toEqual(W.map((w) => expect.closeTo(kmFromStart(w.coordinate), 9)))
    for (const s of c.stops) {
      expect(TRAVERSE.classification !== 'UNAVAILABLE' && TRAVERSE.value.points).toContain(s.waypoint)
      expect(s.sol).toBe(s.waypoint.sol)
      expect(s.rmc).toEqual(s.waypoint.rmc)
    }
  })

  it('walks on to the nearest not yet visited, not back and forth by distance from the start', () => {
    const south = waypoint(north(-0.4))
    const a = waypoint(north(0.5))
    const b = waypoint(north(0.7))
    const c = candidate(traverse([a, b, south]))
    expect(c.stops.map((s) => s.waypoint)).toEqual([south, a, b])
  })

  it('takes no more waypoints than the samples asked for', () => {
    expect(candidate(TRAVERSE, settings({ samples: 2 })).stops.map((s) => s.waypoint)).toEqual([W[0], W[1]])
  })

  it('is UNAVAILABLE, with the reason, without a traverse, a readable one, Perseverance, or a waypoint in reach', () => {
    expect(roverCheckStops(START, null, settings())).toEqual(unavailable(ROVER_CHECK_REASONS.noTraverse))
    const failed = roverCheckStops(START, unavailable('fixture: the feed timed out'), settings())
    expect(failed).toEqual(unavailable('The Perseverance traverse could not be read: fixture: the feed timed out'))
    expect(roverCheckStops(START, traverse(W, 'curiosity'), settings())).toEqual(unavailable(ROVER_CHECK_REASONS.notPerseverance))
    expect(roverCheckStops(START, traverse([EXTRA[2]]), settings())).toEqual(unavailable(ROVER_CHECK_REASONS.noWaypoint))
    expect(roverCheckStops(START, traverse([EXTRA[0]]), settings())).toEqual(unavailable(ROVER_CHECK_REASONS.noWaypoint))
    expect(roverCheckStops(START, TRAVERSE, settings({ samples: 0 }))).toEqual(unavailable(ROVER_CHECK_REASONS.noSamples))
  })

  it('says it picks the nearest waypoints, not the rover\'s sampling sites, and names the traverse', () => {
    const c = roverCheckStops(START, TRAVERSE, settings())
    expect(c.classification).toBe('DERIVED')
    if (c.classification === 'DERIVED') {
      expect(c.method).toMatch(/nearest first/)
      expect(c.method).toMatch(/no official list of sampling sols/)
      expect(c.method).toMatch(/fixture traverse/)
    }
  })
})

describe('fitRoverCheck', () => {
  const fit = (c: RoverCheckCandidate, p: ElevationProfile, s: MissionSettings, back: readonly (ElevationProfile | null)[] = returnsFor(c)) => {
    const r = fitRoverCheck(c, p, s, back)
    if (r.classification === 'UNAVAILABLE') throw new Error(r.reason)
    return r.value
  }

  it('keeps every waypoint when the walk fits, a sample at each waypoint', () => {
    const c = candidate()
    const w = fit(c, profileFor(c), settings())
    expect(w.stops).toHaveLength(4)
    expect(w.cut).toEqual({ count: 0, limit: null, unchecked: null })
    // The walk ends where it began.
    expect(w.path).toEqual([START, ...W.map((p) => p.coordinate), START])
    expect(w.samples.map((s) => s.coordinate)).toEqual(W.map((p) => p.coordinate))
    expect(w.samples.map((s) => s.order)).toEqual([1, 2, 3, 4])
    expect(w.samples.every((s) => s.dwellMin === SAMPLE_MINUTES)).toBe(true)
    // 1.5 km out and 1.5 km back at 2 km/h is 90 min, plus 4 samples of 5 min.
    expect(w.budget.totalMin.classification !== 'UNAVAILABLE' && w.budget.totalMin.value).toBeCloseTo(110, 6)
    expect(w.budget.distanceKm.classification !== 'UNAVAILABLE' && w.budget.distanceKm.value).toBeCloseTo(3, 6)
  })

  it('counts the way back: a walk whose way out alone fits is cut back when coming back does not', () => {
    // To waypoint 3 is 30 min of walking and 15 of samples, 45 in all: within 60. Back from it is 30 more: 75.
    const c = candidate()
    const w = fit(c, profileFor(c), settings({ durationMin: 60 }))
    expect(w.stops.map((s) => s.waypoint)).toEqual([W[0], W[1]])
    expect(w.cut).toEqual({ count: 2, limit: 'duration', unchecked: null })
    // Out 0.6 km and back 0.6 km at 2 km/h is 36 min, plus 2 samples.
    expect(w.budget.totalMin.classification !== 'UNAVAILABLE' && w.budget.totalMin.value).toBeCloseTo(46, 6)
    expect(w.path[w.path.length - 1]).toEqual(START)
  })

  it('checks the slope of the way back too: a waypoint is left off when only the way back from it is too steep', () => {
    // The way out is level. Back from waypoint 3, a 100 m step over 200 m: about 26.6°, over 20°.
    const c = candidate()
    const step = (stop: number, km: number) => (stop === 3 ? -2500 + 500 * Math.min(0.2, Math.max(0, km - 0.4)) : -2500)
    const w = fit(c, profileFor(c), settings(), returnsFor(c, step))
    expect(w.stops.map((s) => s.waypoint)).toEqual([W[0], W[1]])
    expect(w.cut.limit).toBe('slope')
  })

  it('never takes a way back it could not read as free: the walk stops before that waypoint, and says why', () => {
    const c = candidate()
    const back: (ElevationProfile | null)[] = returnsFor(c)
    back[2] = null
    const w = fit(c, profileFor(c), settings(), back)
    expect(w.stops.map((s) => s.waypoint)).toEqual([W[0], W[1]])
    expect(w.cut.limit).toBeNull()
    expect(w.cut.unchecked?.reason).toBe(ROVER_CHECK_NO_RETURN)
    // With no way back read from the first waypoint, there is no walk.
    const none = fitRoverCheck(c, profileFor(c), settings(), [null, ...returnsFor(c).slice(1)])
    expect(none.classification).toBe('UNAVAILABLE')
    if (none.classification === 'UNAVAILABLE') expect(none.reason).toContain(ROVER_CHECK_NO_RETURN)
  })

  it('cuts the walk back to fit the duration, naming the limit', () => {
    // To waypoint 2 and back: 36 + 10 = 46 min; to waypoint 3 and back: 60 + 15 = 75 min, over 50.
    const c = candidate()
    const w = fit(c, profileFor(c), settings({ durationMin: 50 }))
    expect(w.stops.map((s) => s.waypoint)).toEqual([W[0], W[1]])
    expect(w.samples).toHaveLength(2)
    expect(w.cut).toEqual({ count: 2, limit: 'duration', unchecked: null })
  })

  it('cuts the walk back to fit the energy', () => {
    const c = candidate()
    const w = fit(c, profileFor(c), settings({ energyKcal: 60 })) // about 45.7 kcal per level km: 1.2 km out and back fits, 2 km does not
    expect(w.stops).toHaveLength(2)
    expect(w.cut.limit).toBe('energy')
  })

  it('stops before a stretch over the slope limit', () => {
    // A 100 m climb between 0.6 and 0.8 km: about 26.6°, over 20°.
    const c = candidate()
    const climb = (km: number) => -2500 + 500 * Math.min(0.2, Math.max(0, km - 0.6))
    const w = fit(c, profileFor(c, climb), settings())
    expect(w.stops).toHaveLength(2)
    expect(w.cut.limit).toBe('slope')
  })

  it('is UNAVAILABLE, with the limit, when not even the nearest waypoint fits', () => {
    const c = candidate()
    const r = fitRoverCheck(c, profileFor(c), settings({ durationMin: 10 }), returnsFor(c)) // 9 out, 9 back, 5 at the sample: 23 min
    expect(r.classification).toBe('UNAVAILABLE')
    if (r.classification === 'UNAVAILABLE') expect(r.reason).toMatch(/breaks the duration limit/)
  })

  it('keeps the waypoints that fit and stops before one whose way has a missing height', () => {
    // No height between 0.8 and 0.9 km: on the way to waypoint 3 (1.0 km), after waypoints 1 and 2 fit.
    const c = candidate()
    const w = fit(c, profileFor(c, (km) => (km > 0.8 && km < 0.9 ? Number.NaN : -2500)), settings())
    expect(w.stops.map((s) => s.waypoint)).toEqual([W[0], W[1]])
    expect(w.samples).toHaveLength(2)
    expect(w.cut.count).toBe(2)
    expect(w.cut.limit).toBeNull()
    expect(w.cut.unchecked?.limits).toEqual(expect.arrayContaining(['duration', 'energy', 'slope']))
    expect(w.cut.unchecked?.reason).toMatch(/no height/)
  })

  it('is UNAVAILABLE, not a walk, where a height on the way to the first waypoint is missing', () => {
    const c = candidate()
    const r = fitRoverCheck(c, profileFor(c, (km) => (km > 0.1 && km < 0.2 ? Number.NaN : -2500)), settings(), returnsFor(c))
    expect(r.classification).toBe('UNAVAILABLE')
    if (r.classification === 'UNAVAILABLE') expect(r.reason).toMatch(/cannot be checked/)
  })

  it('stays on the rover\'s path at every stop: near zero metres from it', () => {
    const c = candidate()
    const w = fit(c, profileFor(c), settings())
    const roverPath = TRAVERSE.classification !== 'UNAVAILABLE' ? TRAVERSE.value.points.map((p) => p.coordinate) : []
    for (const s of w.stops) expect(distanceToPathKm(s.coordinate, roverPath) * 1000).toBeLessThan(0.001)
  })
})
