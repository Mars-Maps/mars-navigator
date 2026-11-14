import { describe, expect, it } from 'vitest'
import { isAvailable, type RouteRequest, type RouteStrategy } from '../../src/domain'
import { PLACEHOLDER_REASONS } from '../../src/features/route-analysis/strategies/placeholder'
import { SEARCH_PENDING_REASON } from '../../src/features/route-analysis/strategies/searchedRoute'
import {
  ROUTING_STRATEGIES,
  STRATEGY_ORDER,
  getStrategy,
} from '../../src/features/route-analysis/strategies/registry'
import { SHORTEST_PATH_METHOD } from '../../src/features/route-analysis/strategies/shortest'
import { routeLengthKm, surfaceDistanceKm } from '../../src/features/route-analysis/routeDistance'

const ALL: RouteStrategy[] = ['fastest', 'energy-efficient', 'scientific', 'shortest']
/** The three terrain strategies, all searched on terrain: `plan` says they are being planned. */
const SEARCHED = ['fastest', 'energy-efficient', 'scientific'] as const

const at = (latitude: number, longitudeEast: number) => ({ latitude, longitudeEast })

/** Simulated request — test fixture only. */
function request(stops: [number, number][] = []): RouteRequest {
  return {
    departure: at(4.5, 137.4),
    destination: at(5, 138),
    stops: stops.map(([lat, lon]) => at(lat, lon)),
  }
}

describe('routing strategy registry', () => {
  it('has exactly one strategy per RouteStrategy, keyed by its own id', () => {
    expect(Object.keys(ROUTING_STRATEGIES).sort()).toEqual([...ALL].sort())
    for (const id of ALL) expect(ROUTING_STRATEGIES[id].id).toBe(id)
  })

  it('lists every strategy once in STRATEGY_ORDER', () => {
    expect([...STRATEGY_ORDER].sort()).toEqual([...ALL].sort())
    expect(new Set(STRATEGY_ORDER).size).toBe(STRATEGY_ORDER.length)
  })

  it('getStrategy returns the registered strategy', () => {
    for (const id of ALL) expect(getStrategy(id)).toBe(ROUTING_STRATEGIES[id])
  })

  it('every strategy states an objective and the data it requires', () => {
    for (const id of ALL) {
      const s = getStrategy(id)
      expect(s.objective.length).toBeGreaterThan(0)
      expect(s.requires.length).toBeGreaterThan(0)
    }
  })

  it('energy-efficient means human metabolic cost, not battery', () => {
    const s = getStrategy('energy-efficient')
    expect(s.objective).toMatch(/metabolic/i)
    expect(s.objective).not.toMatch(/battery/i)
  })
})

describe.each(SEARCHED)('%s plan() before its search', (id) => {
  const plan = getStrategy(id).plan

  it('draws no path yet: UNAVAILABLE, saying it is being planned', () => {
    expect(plan(request()).path).toEqual({ classification: 'UNAVAILABLE', reason: SEARCH_PENDING_REASON })
    expect(getStrategy(id).planOnTerrain).toBeTypeOf('function')
  })

  it('returns every metric UNAVAILABLE with that reason — never 0', () => {
    expect(plan(request()).metrics).toEqual({
      distanceKm: { classification: 'UNAVAILABLE', reason: SEARCH_PENDING_REASON },
      durationHours: { classification: 'UNAVAILABLE', reason: SEARCH_PENDING_REASON },
      metabolicEnergyKcal: { classification: 'UNAVAILABLE', reason: SEARCH_PENDING_REASON },
    })
  })

  it('names the cited model for duration and metabolic energy where no route states them, with no document number shown', () => {
    expect(PLACEHOLDER_REASONS.duration).toMatch(/the cited walking-speed model is applied along a searched route only/)
    expect(PLACEHOLDER_REASONS.metabolicEnergy).toMatch(/the cited metabolic cost model is applied along a searched route only/)
    for (const reason of Object.values(PLACEHOLDER_REASONS)) expect(reason).not.toMatch(/#\d/)
  })

  it('returns hazards UNAVAILABLE, never an empty list: its points carry no height to scan', () => {
    const hazards = plan(request()).hazards
    expect(hazards.classification).toBe('UNAVAILABLE')
    if (hazards.classification === 'UNAVAILABLE') expect(hazards.reason).toMatch(/^Nothing was scanned: /)
  })
})

describe.each(ALL)('%s plan() (every strategy)', (id) => {
  const plan = getStrategy(id).plan

  it('tags the option with its strategy', () => {
    const option = plan(request())
    expect(option.strategy).toBe(id)
    expect(option.id).toBe(`option-${id}`)
  })

  it('with no stops, points are departure then destination', () => {
    const points = plan(request()).points
    expect(points.map((p) => p.coordinate)).toEqual([at(4.5, 137.4), at(5, 138)])
  })

  it('keeps stops in order, between departure and destination', () => {
    const points = plan(request([[4.6, 137.5], [4.8, 137.8]])).points
    expect(points.map((p) => p.coordinate)).toEqual([
      at(4.5, 137.4),
      at(4.6, 137.5),
      at(4.8, 137.8),
      at(5, 138),
    ])
  })

  it('keeps duplicate stops rather than silently dropping them', () => {
    const points = plan(request([[4.6, 137.5], [4.6, 137.5]])).points
    expect(points).toHaveLength(4)
  })

  it('gives every point a unique id and UNAVAILABLE elevation', () => {
    const points = plan(request([[4.6, 137.5], [4.6, 137.5]])).points
    expect(new Set(points.map((p) => p.id)).size).toBe(points.length)
    for (const p of points) {
      expect(p.elevationMeters).toEqual({
        classification: 'UNAVAILABLE',
        reason: PLACEHOLDER_REASONS.elevation,
      })
    }
  })

  it('does not mutate or alias the request', () => {
    const req = request([[4.6, 137.5]])
    const before = structuredClone(req)
    const option = plan(req)
    expect(req).toEqual(before)
    option.points[0].coordinate.latitude = 0
    expect(req.departure.latitude).toBe(4.5)
  })
})

describe('shortest plan()', () => {
  const plan = getStrategy('shortest').plan

  it('draws the waypoints as its path, DERIVED with the great-circle method', () => {
    const option = plan(request([[4.6, 137.5]]))
    expect(isAvailable(option.path)).toBe(true)
    if (!isAvailable(option.path)) return
    expect(option.path.classification).toBe('DERIVED')
    if (option.path.classification === 'DERIVED') expect(option.path.method).toBe(SHORTEST_PATH_METHOD)
    expect(option.path.value).toBe(option.points)
  })

  it('reports the haversine distance of the legs, DERIVED, equal to routeLengthKm', () => {
    const req = request([[4.6, 137.5], [4.8, 137.8]])
    const option = plan(req)
    const expected = routeLengthKm({ id: 'x', name: 'x', classification: 'DERIVED', points: option.points })
    expect(option.metrics.distanceKm).toEqual(expected)
    if (!isAvailable(option.metrics.distanceKm)) throw new Error('unreachable')
    const legs =
      surfaceDistanceKm(req.departure, req.stops[0]) +
      surfaceDistanceKm(req.stops[0], req.stops[1]) +
      surfaceDistanceKm(req.stops[1], req.destination)
    expect(option.metrics.distanceKm.value).toBeCloseTo(legs, 9)
    expect(option.metrics.distanceKm.value).toBeGreaterThan(0)
  })

  it('is zero only for a route that goes nowhere, and says so honestly', () => {
    const here = at(4.5, 137.4)
    const option = plan({ departure: here, destination: here, stops: [] })
    expect(option.metrics.distanceKm).toMatchObject({ classification: 'DERIVED', value: 0 })
  })

  it('claims nothing about time, energy or hazards', () => {
    const { metrics, hazards } = plan(request())
    expect(metrics.durationHours).toEqual({ classification: 'UNAVAILABLE', reason: PLACEHOLDER_REASONS.duration })
    expect(metrics.metabolicEnergyKcal).toEqual({
      classification: 'UNAVAILABLE',
      reason: PLACEHOLDER_REASONS.metabolicEnergy,
    })
    expect(isAvailable(hazards)).toBe(false)
  })

  it('states that terrain is not considered', () => {
    expect(SHORTEST_PATH_METHOD).toMatch(/terrain is not considered/)
    expect(getStrategy('shortest').objective).toMatch(/distance/i)
  })
})
