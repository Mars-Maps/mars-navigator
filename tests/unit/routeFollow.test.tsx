import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { SUITED_SLOPE_LIMIT, derived, type GeologicUnit, type RouteOption, type RouteRequest, type SurfacePoint } from '../../src/domain'
import { ROUTE_ONLY, routeHudStops } from '../../src/features/mission-ui/hud/hudMath'
import { NO_PROFILE_REASON, routeWaypoints } from '../../src/features/mission-ui/hud/routeWaypoints'
import { SurfaceHud } from '../../src/features/mission-ui/hud/SurfaceHud'
import { READING_GEOLOGIC_UNIT_REASON } from '../../src/features/mission-ui/pointFields'
import { ROUTE_WAYPOINT_ONLY, routeStopFacts } from '../../src/features/mission-ui/stops/stopCardMath'
import { FIRST_AIMED_INDEX, useRouteFollow } from '../../src/state'

// Test fixture only: a route whose strategy added a stop (b) before the user's (c), never shown in the app.
const point = (id: string, latitude: number, longitudeEast: number, label?: string): SurfacePoint => ({
  id,
  coordinate: { latitude, longitudeEast },
  elevationMeters: { classification: 'UNAVAILABLE', reason: 'fixture' },
  ...(label ? { label } : {}),
})
const ROUTE: RouteOption = {
  id: 'fixture-route',
  strategy: 'shortest',
  points: [point('a', 18.4, 77.4), point('b', 18.42, 77.45), point('c', 18.45, 77.5, 'Delta front'), point('d', 18.5, 77.6)],
  path: derived([point('a', 18.4, 77.4), point('d', 18.5, 77.6)], 'fixture method'),
  metrics: {
    distanceKm: derived(15.2, 'fixture'),
    durationHours: { classification: 'UNAVAILABLE', reason: 'fixture' },
    metabolicEnergyKcal: { classification: 'UNAVAILABLE', reason: 'fixture' },
  },
  hazards: { classification: 'UNAVAILABLE', reason: 'fixture' },
}
const REQUEST: RouteRequest = {
  departure: { latitude: 18.4, longitudeEast: 77.4 },
  stops: [{ latitude: 18.45, longitudeEast: 77.5 }],
  destination: { latitude: 18.5, longitudeEast: 77.6 },
}
const WAYPOINTS = routeWaypoints(ROUTE, REQUEST, null)

describe('useRouteFollow: the waypoint aimed at on a followed route', () => {
  beforeEach(() => useRouteFollow.setState({ routeId: null, aimedIndex: FIRST_AIMED_INDEX }))

  it('starts at the waypoint after departure', () => {
    expect(FIRST_AIMED_INDEX).toBe(1)
    expect(useRouteFollow.getState().aimedIndex).toBe(1)
  })

  it('a route first stood on starts after departure; the same route keeps its aim; another route starts over', () => {
    useRouteFollow.getState().followRoute('r1', 4)
    useRouteFollow.getState().aimAt(3, 4)
    useRouteFollow.getState().followRoute('r1', 4)
    expect(useRouteFollow.getState().aimedIndex).toBe(3)
    useRouteFollow.getState().followRoute('r2', 3)
    expect(useRouteFollow.getState()).toMatchObject({ routeId: 'r2', aimedIndex: 1 })
    // The same route with fewer points keeps the aim within it.
    useRouteFollow.getState().aimAt(2, 3)
    useRouteFollow.getState().followRoute('r2', 2)
    expect(useRouteFollow.getState().aimedIndex).toBe(1)
  })

  // The option's id is `option-<strategy>` for every request, so it cannot say "the same route".
  it('is keyed by the waypoints: a new request starts over though the option id is the same', () => {
    const key = (lon: number) => `18.4,77.4;18.5,${lon}`
    useRouteFollow.getState().followRoute(key(77.5), 4)
    useRouteFollow.getState().aimAt(3, 4)
    useRouteFollow.getState().followRoute(key(77.6), 4)
    expect(useRouteFollow.getState().aimedIndex).toBe(FIRST_AIMED_INDEX)
    useRouteFollow.getState().aimAt(2, 4)
    useRouteFollow.getState().followRoute(key(77.6), 4)
    expect(useRouteFollow.getState().aimedIndex).toBe(2)
  })

  it('aims within the route, and at departure alone on a route of one point', () => {
    useRouteFollow.getState().aimAt(2, 3)
    expect(useRouteFollow.getState().aimedIndex).toBe(2)
    useRouteFollow.getState().aimAt(7, 3)
    expect(useRouteFollow.getState().aimedIndex).toBe(2)
    useRouteFollow.getState().aimAt(-1, 3)
    expect(useRouteFollow.getState().aimedIndex).toBe(0)
    useRouteFollow.getState().aimAt(1, 1)
    expect(useRouteFollow.getState().aimedIndex).toBe(0)
  })
})

describe('routeHudStops: the user’s waypoints as the HUD’s stops', () => {
  const stops = routeHudStops(WAYPOINTS)

  it('only the user’s waypoints, a label the point carries winning over Stop n', () => {
    expect(stops.map((s) => s.label)).toEqual(['Departure', 'Delta front', 'Destination'])
  })

  it('the departure has no leg; the others pass the profile’s reason on; hazards are route-only', () => {
    expect(stops[0].steepestSlopeDeg.classification).toBe('UNAVAILABLE')
    expect(stops[1].steepestSlopeDeg).toEqual({ classification: 'UNAVAILABLE', reason: NO_PROFILE_REASON })
    for (const stop of stops) expect(stop.legHazards).toEqual({ classification: 'UNAVAILABLE', reason: ROUTE_ONLY.hazards })
  })

  it('the HUD renders them and aims at the chosen one', () => {
    const html = renderToStaticMarkup(
      <SurfaceHud
        heading={derived(90, 'fixture')}
        position={derived({ latitude: 18.4, longitudeEast: 77.4 }, 'fixture')}
        stops={stops}
        slopeLimit={SUITED_SLOPE_LIMIT}
        activeStopIndex={1}
        onGoToStop={() => {}}
        sunElevationDeg={derived(30, 'fixture')}
        solar={{ classification: 'UNAVAILABLE', reason: 'fixture' }}
      />,
    )
    expect(html).toContain('Delta front')
    expect(html).toContain('2 of 3')
    expect(html).not.toContain('No walk planned yet')
  })
})

// Test fixture only: an invented unit, never shown in the app.
const UNIT = { symbol: 'Xf', name: 'Fixture unit' } as GeologicUnit

describe('routeStopFacts: a route waypoint on the stop card', () => {
  it('keeps the name, takes the unit read for it, has no reason, and carries the leg’s slope', () => {
    const facts = routeStopFacts(WAYPOINTS, 1, derived(UNIT, 'fixture'))
    expect(facts?.label).toBe('Delta front')
    expect(facts?.unit).toEqual(derived(UNIT, 'fixture'))
    expect(facts?.reason).toBeNull()
    expect(facts?.fromPreviousKm).toEqual({ classification: 'UNAVAILABLE', reason: ROUTE_WAYPOINT_ONLY.distance })
    expect(facts?.legSteepestSlopeDeg).toEqual({ classification: 'UNAVAILABLE', reason: NO_PROFILE_REASON })
    expect(facts?.legHazards).toEqual({ classification: 'UNAVAILABLE', reason: ROUTE_ONLY.hazards })
    expect(facts?.slopeLimit).toBe(SUITED_SLOPE_LIMIT)
  })

  it('a unit still being read says so, never a blank', () => {
    expect(routeStopFacts(WAYPOINTS, 2, null)?.unit).toEqual({ classification: 'UNAVAILABLE', reason: READING_GEOLOGIC_UNIT_REASON })
  })

  it('the departure has no leg into it, and an index past the waypoints is null', () => {
    const first = routeStopFacts(WAYPOINTS, 0, null)
    expect(first?.label).toBe('Departure')
    expect(first?.fromPreviousKm).toBeNull()
    expect(first?.legSteepestSlopeDeg).toBeNull()
    expect(first?.legHazards).toBeNull()
    expect(routeStopFacts(WAYPOINTS, 3, null)).toBeNull()
  })
})
