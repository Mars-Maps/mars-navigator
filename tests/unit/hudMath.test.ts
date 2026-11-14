import { describe, expect, it } from 'vitest'
import {
  derived,
  localTrueSolarTimeHours,
  simulated,
  SUITED_SLOPE_LIMIT,
  unavailable,
  walkPlanProblem,
  type Classified,
  type MarsCoordinate,
  type MarsSolarTime,
  type RouteOption,
  type RouteRequest,
  type SurfacePoint,
  type WalkLeg,
  type WalkPlan,
  type WalkStop,
} from '../../src/domain'
import {
  describeSunElevation,
  formatBearing,
  hudStops,
  hudWayPoints,
  localSolarTime,
  shownSunElevation,
  type HudStop,
} from '../../src/features/mission-ui/hud/hudMath'
import { legSteepestSlopes, NO_PROFILE_REASON, routeWaypoints, waypointsKey } from '../../src/features/mission-ui/hud/routeWaypoints'
import { distanceAndBearing } from '../../src/features/route-analysis/distanceAndBearing'
import type { ElevationProfile } from '../../src/features/route-analysis/elevationProfile'
import { slopeDegrees } from '../../src/features/route-analysis/profileSlope'
import { surfaceDistanceKm } from '../../src/features/route-analysis/routeDistance'

// Test fixtures only — invented positions, stops, slopes and clock, never shown in the app.
const HERE: MarsCoordinate = { latitude: 18.4, longitudeEast: 77.5 }
const STOPS: HudStop[] = [
  { label: 'fixture-stop-1', coordinate: { latitude: 18.45, longitudeEast: 77.52 }, steepestSlopeDeg: derived(4, 'fixture'), legHazards: derived([], 'fixture') },
  { label: 'fixture-stop-2', coordinate: { latitude: 18.39, longitudeEast: 77.4 }, steepestSlopeDeg: derived(9, 'fixture'), legHazards: derived([], 'fixture') },
]
const SOLAR: MarsSolarTime = {
  marsSolDate: 50000,
  coordinatedMarsTimeHours: 6.5,
  solarLongitudeDeg: 100,
  equationOfTimeDeg: -3,
  heliocentricDistanceAu: 1.52,
  subsolarPoint: { latitude: 0, longitudeEast: 0 },
}

const walkStop = (id: string, latitude: number, longitudeEast: number): WalkStop => ({
  id,
  label: `fixture-${id}`,
  coordinate: { latitude, longitudeEast },
  unit: unavailable('fixture-no-map'),
  reason: derived('fixture-reason', 'fixture'),
})
const leg = (fromStopId: string, toStopId: string, slope: number): WalkLeg => ({
  fromStopId,
  toStopId,
  path: unavailable('fixture'),
  distanceKm: derived(1, 'fixture'),
  steepestSlopeDeg: derived(slope, 'fixture-dem'),
  hazards: derived([], 'fixture'),
})
const PLAN: WalkPlan = {
  goal: { id: 'fixture-goal', label: 'fixture-goal', unitNames: ['fixture-unit'], reason: derived('fixture', 'fixture') },
  stops: [walkStop('a', 18.4, 77.5), walkStop('b', 18.41, 77.5), walkStop('c', 18.42, 77.51)],
  legs: [leg('a', 'b', 4), leg('b', 'c', 23)],
  slopeLimit: SUITED_SLOPE_LIMIT,
}

describe('hudStops', () => {
  it('uses a fixture that keeps the walk-plan contract', () => {
    expect(walkPlanProblem(PLAN)).toBeNull()
  })

  it('gives each plan stop its label and coordinate, with the slope of the leg into it', () => {
    const stops = hudStops(PLAN)
    expect(stops.map((s) => s.label)).toEqual(['fixture-a', 'fixture-b', 'fixture-c'])
    expect(stops[2].coordinate).toEqual({ latitude: 18.42, longitudeEast: 77.51 })
    expect(stops[1].steepestSlopeDeg).toEqual(derived(4, 'fixture-dem'))
    expect(stops[2].steepestSlopeDeg).toEqual(derived(23, 'fixture-dem'))
  })

  it('says the walk starts at the first stop, which no leg leads to, never a slope of 0', () => {
    expect(hudStops(PLAN)[0].steepestSlopeDeg).toEqual(unavailable('The walk starts here, so no leg leads to this stop'))
  })

  it('says so when a plan has no leg into a stop', () => {
    const short: WalkPlan = { ...PLAN, legs: [leg('a', 'b', 4)] }
    expect(hudStops(short)[2].steepestSlopeDeg).toEqual(unavailable('The plan has no leg into this stop'))
    expect(hudStops(short)[2].legHazards).toEqual(unavailable('The plan has no leg into this stop'))
  })

  it('gives each stop the hazards of the leg into it, and none scanned at the start', () => {
    const stops = hudStops(PLAN)
    expect(stops[1].legHazards).toBe(PLAN.legs[0].hazards)
    expect(stops[2].legHazards).toBe(PLAN.legs[1].hazards)
    expect(stops[0].legHazards).toEqual(unavailable('The walk starts here, so no leg leads to this stop'))
  })
})

describe('hudWayPoints', () => {
  it('gives each stop the planner’s great-circle distance and bearing from the walker, keeping its label', () => {
    const points = hudWayPoints(derived(HERE, 'fixture-position'), STOPS)
    expect(points.map((p) => p.label)).toEqual(['fixture-stop-1', 'fixture-stop-2'])
    STOPS.forEach((s, i) => {
      const expected = distanceAndBearing(HERE, s.coordinate)
      const { distanceKm, bearingDeg } = points[i]
      if (distanceKm.classification !== 'DERIVED' || bearingDeg.classification !== 'DERIVED') throw new Error('expected DERIVED')
      if (expected.distanceKm.classification !== 'DERIVED' || expected.initialBearingDeg.classification !== 'DERIVED') {
        throw new Error('fixture has no direction')
      }
      expect(distanceKm.value).toBe(expected.distanceKm.value)
      expect(bearingDeg.value).toBe(expected.initialBearingDeg.value)
      expect(distanceKm.method).toBe(`${expected.distanceKm.method}, from your position (fixture-position)`)
      expect(bearingDeg.method).toBe(`${expected.initialBearingDeg.method}, from your position (fixture-position)`)
    })
  })

  it('is SIMULATED when the position is', () => {
    const [p] = hudWayPoints(simulated(HERE, 'fixture-sim'), STOPS)
    expect(p.distanceKm.classification).toBe('SIMULATED')
    expect(p.bearingDeg.classification).toBe('SIMULATED')
  })

  it('is UNAVAILABLE for every stop, with the reason, while the position is', () => {
    const points = hudWayPoints(unavailable('fixture-no-ground'), STOPS)
    expect(points).toHaveLength(2)
    for (const p of points) {
      expect(p.distanceKm).toEqual(unavailable('No position: fixture-no-ground'))
      expect(p.bearingDeg).toEqual(unavailable('No position: fixture-no-ground'))
    }
  })

  it('keeps the bearing UNAVAILABLE at the stop itself, never 0', () => {
    const [p] = hudWayPoints(derived(HERE, 'fixture-position'), [{ ...STOPS[0], coordinate: HERE }])
    expect(p.bearingDeg.classification).toBe('UNAVAILABLE')
    expect(p.distanceKm.classification).toBe('DERIVED')
  })

  it('returns nothing for no stops', () => {
    expect(hudWayPoints(derived(HERE, 'fixture-position'), [])).toEqual([])
  })
})

describe('formatBearing', () => {
  it('rounds to the whole degree in 0–359', () => {
    expect(formatBearing(0)).toBe('0°')
    expect(formatBearing(132.4)).toBe('132°')
    expect(formatBearing(359.6)).toBe('0°')
    expect(formatBearing(-1)).toBe('359°')
  })
})

describe('the sun', () => {
  it('shows an elevation between −90° and 90°, and anything else as UNAVAILABLE', () => {
    expect(shownSunElevation(derived(-90, 'fixture'))).toEqual(derived(-90, 'fixture'))
    expect(shownSunElevation(derived(90, 'fixture'))).toEqual(derived(90, 'fixture'))
    expect(shownSunElevation(unavailable('fixture-sky'))).toEqual(unavailable('fixture-sky'))
    for (const bad of [90.5, -91, Number.NaN]) {
      expect(shownSunElevation(derived(bad, 'fixture')).classification).toBe('UNAVAILABLE')
    }
  })

  it('says the elevation in words, to the whole degree', () => {
    expect(describeSunElevation(34.4)).toBe('34° above the horizon')
    expect(describeSunElevation(0.5)).toBe('1° above the horizon')
    expect(describeSunElevation(0.49)).toBe('on the horizon')
    expect(describeSunElevation(-0.4)).toBe('on the horizon')
    expect(describeSunElevation(-2.6)).toBe('3° below the horizon')
  })
})

describe('localSolarTime', () => {
  it('is the time menu’s Mars24 local true solar time at the walker’s longitude, DERIVED with the method', () => {
    const t = localSolarTime(derived(SOLAR, 'fixture-mars24'), derived(HERE, 'fixture-position'))
    if (t.classification !== 'DERIVED') throw new Error('expected DERIVED')
    expect(t.value).toBe(localTrueSolarTimeHours(SOLAR, HERE.longitudeEast))
    expect(t.method).toBe('Local true solar time at your longitude, from the mission clock in the time menu: fixture-mars24')
  })

  it('is SIMULATED when the position is', () => {
    expect(localSolarTime(derived(SOLAR, 'fixture-mars24'), simulated(HERE, 'fixture-sim')).classification).toBe('SIMULATED')
  })

  it('is UNAVAILABLE with the reason without the time or the position', () => {
    expect(localSolarTime(unavailable('fixture-clock'), derived(HERE, 'fixture-position'))).toEqual(
      unavailable('No Mars time: fixture-clock'),
    )
    expect(localSolarTime(derived(SOLAR, 'fixture-mars24'), unavailable('fixture-no-ground'))).toEqual(
      unavailable('No position: fixture-no-ground'),
    )
  })
})

// Test fixtures only — an invented route, path and heights, never shown in the app. The
// strategy added a stop (S) the user did not set, as the scientific route does.
const A: MarsCoordinate = { latitude: 18.359, longitudeEast: 77.765 }
const M1: MarsCoordinate = { latitude: 18.352, longitudeEast: 77.76 }
const S: MarsCoordinate = { latitude: 18.345, longitudeEast: 77.755 }
const U: MarsCoordinate = { latitude: 18.25, longitudeEast: 77.7 }
const M2: MarsCoordinate = { latitude: 18.16, longitudeEast: 77.63 }
const D: MarsCoordinate = { latitude: 18.071, longitudeEast: 77.563 }
const surface = (c: MarsCoordinate, i: number): SurfacePoint => ({ id: `fixture-${i}`, coordinate: { ...c }, elevationMeters: unavailable('fixture') })
const PATH = [A, M1, S, U, M2, D]
const HEIGHTS = [0, 10, 5, 40, 40, 30]
const routeOf = (path: Classified<SurfacePoint[]>): RouteOption => ({
  id: 'option-scientific',
  strategy: 'scientific',
  points: [A, S, U, D].map(surface),
  path,
  metrics: { distanceKm: unavailable('fixture'), durationHours: unavailable('fixture'), metabolicEnergyKcal: unavailable('fixture') },
  hazards: unavailable('fixture'),
})
const ROUTE = routeOf(derived(PATH.map(surface), 'fixture path'))
const ALONG = PATH.reduce<number[]>((km, c, i) => [...km, i === 0 ? 0 : km[i - 1] + surfaceDistanceKm(PATH[i - 1], c)], [])
const profileOf = (heights: readonly number[], total = ALONG[ALONG.length - 1]): Classified<ElevationProfile> =>
  derived(
    {
      samples: PATH.map((c, i) => ({
        coordinate: c,
        distanceKm: ALONG[i],
        elevationMeters: Number.isNaN(heights[i]) ? unavailable<number>('fixture no data') : derived(heights[i], 'fixture height'),
      })),
      totalDistanceKm: total,
    },
    'fixture profile',
  )
const stretch = (i: number) => slopeDegrees(HEIGHTS[i] - HEIGHTS[i - 1], ALONG[i] - ALONG[i - 1])

describe('routeWaypoints: only the user’s waypoints of a followed route', () => {
  it('a plain route is its departure and destination, never a stop the strategy added', () => {
    const plain: RouteRequest = { departure: A, stops: [], destination: D }
    expect(routeWaypoints(ROUTE, plain, null).map((w) => w.label)).toEqual(['Departure', 'Destination'])
  })

  it('the user’s stops, named by their place in the search bar; one not on the route is left out', () => {
    const request: RouteRequest = { departure: A, stops: [{ latitude: 1, longitudeEast: 2 }, U], destination: D }
    const waypoints = routeWaypoints(ROUTE, request, null)
    expect(waypoints.map((w) => w.label)).toEqual(['Departure', 'Stop 2', 'Destination'])
    expect(waypoints.map((w) => w.coordinate)).toEqual([A, U, D])
  })

  it('with no request, the two ends alone', () => {
    expect(routeWaypoints(ROUTE, null, null).map((w) => w.label)).toEqual(['Departure', 'Destination'])
  })

  it('the departure has no leg; each other waypoint has the steepest stretch on the way in', () => {
    const request: RouteRequest = { departure: A, stops: [U], destination: D }
    const [first, stop, last] = routeWaypoints(ROUTE, request, profileOf(HEIGHTS))
    expect(first.legSteepestSlopeDeg).toBeNull()
    expect(stop.legSteepestSlopeDeg).toMatchObject({ classification: 'DERIVED', value: Math.max(stretch(1), stretch(2), stretch(3)) })
    expect(last.legSteepestSlopeDeg).toMatchObject({ classification: 'DERIVED', value: Math.max(stretch(4), stretch(5)) })
  })
})

describe('waypointsKey: what makes two followed routes the same to the walk guide', () => {
  const plain: RouteRequest = { departure: A, stops: [], destination: D }

  it('is the same for the same user waypoints, whatever the strategy or the slopes read', () => {
    const other = { ...ROUTE, id: 'option-other', strategy: 'energy-efficient' } as typeof ROUTE
    expect(waypointsKey(routeWaypoints(other, plain, profileOf(HEIGHTS)))).toBe(waypointsKey(routeWaypoints(ROUTE, plain, null)))
  })

  it('differs when a stop is added, though the route option and its id are the same', () => {
    const withStop: RouteRequest = { departure: A, stops: [U], destination: D }
    expect(waypointsKey(routeWaypoints(ROUTE, withStop, null))).not.toBe(waypointsKey(routeWaypoints(ROUTE, plain, null)))
  })

  it('differs for the same places in another order, and is empty for no waypoints', () => {
    const [a, d] = routeWaypoints(ROUTE, plain, null)
    expect(waypointsKey([d, a])).not.toBe(waypointsKey([a, d]))
    expect(waypointsKey([])).toBe('')
  })
})

describe('legSteepestSlopes: a route leg’s steepest stretch from its elevation profile', () => {
  it('DERIVED, its method naming the profile’s stretches and the profile itself', () => {
    const [leg] = legSteepestSlopes(ROUTE, [A, D], profileOf(HEIGHTS))
    expect(leg.classification).toBe('DERIVED')
    if (leg.classification !== 'DERIVED') return
    expect(leg.value).toBeCloseTo(Math.max(...[1, 2, 3, 4, 5].map(stretch)), 12)
    expect(leg.method).toContain('elevation profile')
    expect(leg.method).toContain('fixture profile')
  })

  it('a leg with a stretch of no height is UNAVAILABLE, the other leg still measured', () => {
    const [into, out] = legSteepestSlopes(ROUTE, [A, U, D], profileOf([0, 10, Number.NaN, 40, 40, 30]))
    expect(into.classification).toBe('UNAVAILABLE')
    expect(out.classification).toBe('DERIVED')
  })

  it('UNAVAILABLE with the reason with no profile, while it is read, or for another path', () => {
    expect(legSteepestSlopes(ROUTE, [A, D], null)).toEqual([unavailable(NO_PROFILE_REASON)])
    expect(legSteepestSlopes(ROUTE, [A, D], unavailable('fixture sampling'))).toEqual([unavailable(`${NO_PROFILE_REASON}: fixture sampling`)])
    expect(legSteepestSlopes(ROUTE, [A, D], profileOf(HEIGHTS, 99))[0].classification).toBe('UNAVAILABLE')
  })

  it('a route with no planned path says so, never a slope of straight lines', () => {
    const [leg] = legSteepestSlopes(routeOf(unavailable('fixture no path')), [A, D], profileOf(HEIGHTS))
    expect(leg).toEqual(unavailable('The route has no planned path to measure slopes along: fixture no path'))
  })

  it('a SIMULATED height makes the slope SIMULATED', () => {
    const p = profileOf(HEIGHTS)
    if (p.classification !== 'DERIVED') throw new Error('fixture')
    p.value.samples[1] = { ...p.value.samples[1], elevationMeters: simulated(10, 'fixture mock') }
    expect(legSteepestSlopes(ROUTE, [A, U], p)[0].classification).toBe('SIMULATED')
  })
})
