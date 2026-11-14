import { describe, expect, it } from 'vitest'
import { isAvailable, type Classified, type GeologicUnitArea } from '../../src/domain'
import {
  SCIENCE_DETOUR_KM,
  pickScienceStops,
  planScientific,
  scientific,
  unitsCrossed,
} from '../../src/features/route-analysis/strategies/scientific'
import { SEARCH_PENDING_REASON } from '../../src/features/route-analysis/strategies/searchedRoute'
import { MAP, START, at, fixtureTerrain, xyOf } from './terrain.helpers'

// Test fixtures only: invented unit squares near Jezero, named as SIM 3464 names its units so the goal table matches them.
const square = (symbol: string, name: string, x0: number, y0: number, x1: number, y1: number): GeologicUnitArea => ({
  unit: { symbol, name, map: MAP },
  rings: [[at(x0, y0), at(x1, y0), at(x1, y1), at(x0, y1), at(x0, y0)]],
})
const FLOOR = square('Jf', 'Jezero floor unit', -1, -1, 1, 1)
const FAN1 = square('Jf1', 'Jezero fan 1 unit', 1.5, -0.5, 2.5, 0.5)
const RIM = square('cr', 'Crater rim unit', -0.5, 2.5, 0.5, 3.5)
// The map spells the rim unit two ways (scienceGoals.ts): one unit, by its symbol.
const RIIM = square('cr', 'Crater riim unit', -0.5, 4, 0.5, 4.5)
// Out of the 5 km range from the start.
const FAN2 = square('Jf2', 'Jezero fan 2 unit', 10, 0, 11, 1)
const UNITS = [FLOOR, FAN1, RIM, RIIM, FAN2]

const signal = new AbortController().signal
/** A DERIVED value's method, '' for any other. */
const methodOf = <T>(c: Classified<T> | undefined) => (c?.classification === 'DERIVED' ? c.method : '')
const request = (x: number, y: number) => ({ departure: START, destination: at(x, y), stops: [] })

describe('science stops', () => {
  it("takes one stop per unit the goals name, nearest polygon first, not the start's unit, and the rim once however it is spelled", () => {
    const pick = pickScienceStops(request(3, 3), UNITS)
    expect(pick.stops.map((s) => s.symbol)).toEqual(['Jf1', 'cr'])
    expect(pick.stops[1].unitName).toBe('Crater rim unit')
    expect(pick.stops[0].goals).toEqual(['Delta deposits'])
    expect(pick.skipped).toEqual([])
    // The fan 2 polygon lies past the 5 km range, so it is not a candidate at all.
    expect([...pick.stops, ...pick.skipped].some((s) => s.symbol === 'Jf2')).toBe(false)
  })

  it('leaves out a stop that would make the walk longer than the budget, and lists it with the length it would make', () => {
    const pick = pickScienceStops(request(0, -1), UNITS)
    expect(pick.budgetKm).toBeCloseTo(1 + SCIENCE_DETOUR_KM, 1)
    expect(pick.stops.map((s) => s.symbol)).toEqual(['Jf1'])
    expect(pick.skipped.map((s) => s.symbol)).toEqual(['cr'])
    expect(pick.skipped[0].wouldMakeKm).toBeGreaterThan(pick.budgetKm)
  })
})

describe('units crossed', () => {
  it('counts each unit under the path once, in the order met, and says how much of the path fell on none', () => {
    const crossed = unitsCrossed([at(0, 0), at(2, 0)], UNITS, 'fixture method')
    expect(crossed.classification).toBe('DERIVED')
    if (!isAvailable(crossed)) return
    expect(crossed.value).toEqual(['Jezero floor unit', 'Jezero fan 1 unit'])
    expect(methodOf(crossed)).toMatch(/% of the samples fell on no unit read/)
    expect(methodOf(crossed)).toMatch(/fixture method$/)
  })

  it('counts a unit the map spells two ways as one', () => {
    const crossed = unitsCrossed([at(0, 2.8), at(0, 4.2)], UNITS, '')
    expect(isAvailable(crossed) && crossed.value).toEqual(['Crater rim unit'])
  })

  it('is UNAVAILABLE, never an empty list, when the path crosses no unit read', () => {
    expect(unitsCrossed([at(20, 20), at(21, 20)], UNITS, '').classification).toBe('UNAVAILABLE')
  })
})

describe('planScientific', () => {
  it('walks the searched route through the science stops and states the units it crosses', async () => {
    const option = await planScientific(request(3, 3), fixtureTerrain(() => 0, { units: UNITS }), signal)
    expect(option.path.classification).toBe('DERIVED')
    // Departure, the two science stops, destination.
    expect(option.points).toHaveLength(4)
    expect(xyOf(option.points[1].coordinate).x).toBeGreaterThan(1.5)
    const crossed = option.metrics.unitsCrossed
    expect(crossed?.classification).toBe('DERIVED')
    if (!crossed || !isAvailable(crossed)) return
    // Every unit visited is crossed, and the count is of distinct units.
    expect(crossed.value).toEqual(expect.arrayContaining(['Jezero floor unit', 'Jezero fan 1 unit', 'Crater rim unit']))
    expect(new Set(crossed.value).size).toBe(crossed.value.length)
    expect(methodOf(crossed)).toMatch(/Visited, by the map's simplified polygons: Jezero fan 1 unit \(Delta deposits\), Crater rim unit \(Ancient crust\)/)
    // The map's own source line, as its adapter gives it: the fixture's is 'fixture units'.
    expect(methodOf(crossed)).toMatch(/Map: fixture units$/)
    expect(methodOf(crossed)).toMatch(/Visited, by the map's simplified polygons: /)
    expect(isAvailable(option.metrics.durationHours)).toBe(true)
    expect(isAvailable(option.metrics.metabolicEnergyKcal)).toBe(true)
    expect(methodOf(option.path)).toMatch(/Visited, by the map's simplified polygons/)
  })

  it('lists skipped stops in the methods', async () => {
    const option = await planScientific(request(0, -1), fixtureTerrain(() => 0, { units: UNITS }), signal)
    const crossed = option.metrics.unitsCrossed
    expect(methodOf(crossed)).toMatch(/Skipped, as each would make the walk longer than 6\.0 km in straight lines: Crater rim unit \(\d+\.\d km\)/)
  })

  it("says why there is no path when the map's units cannot be read, or there are none", async () => {
    const failed = await planScientific(request(3, 3), fixtureTerrain(() => 0, { unitsFail: 'fixture-down' }), signal)
    expect(failed.path).toEqual({ classification: 'UNAVAILABLE', reason: expect.stringMatching(/units could not be read.*fixture-down/) })
    expect(failed.metrics.unitsCrossed).toBeUndefined()
    const none = await planScientific(request(3, 3), fixtureTerrain(() => 0), signal)
    expect(none.path).toEqual({ classification: 'UNAVAILABLE', reason: expect.stringMatching(/no units within 5 km/) })
  })

  // With no stop of its own the route would be the fastest one under another name.
  it('draws nothing, and says why, when no science stop can be picked', async () => {
    // The departure and destination stand on the floor, and no other goal unit is in reach.
    const option = await planScientific(request(0.5, 0.5), fixtureTerrain(() => 0, { units: [FLOOR, FAN2] }), signal)
    expect(option.path).toEqual({
      classification: 'UNAVAILABLE',
      reason: expect.stringMatching(/No ground of a unit the science goals name lies within 5 km of the departure off the unit it stands on, so this route has no science stop/),
    })
    expect(option.metrics.unitsCrossed).toBeUndefined()
    // Fan 1 in reach (4.45 km) but over a 0.5 km walk's budget (5.5 km): it says so, not that none is in reach.
    const farFan = square('Jf1', 'Jezero fan 1 unit', 4.4, -0.5, 5, 0.5)
    const over = await planScientific(request(-0.5, 0), fixtureTerrain(() => 0, { units: [FLOOR, farFan] }), signal)
    expect(over.path).toEqual({
      classification: 'UNAVAILABLE',
      reason: expect.stringMatching(/^Every science stop in reach \(Jezero fan 1 unit\) would make the walk longer than 5\.5 km/),
    })
  })

  it("visits the science stops before the requested ones, and counts the requested ones in the budget", async () => {
    const stop = at(3, 3)
    const option = await planScientific({ departure: START, destination: at(3, 0), stops: [stop] }, fixtureTerrain(() => 0, { units: UNITS }), signal)
    // Departure, fan 1, the rim, then the requested stop and the destination.
    const xy = option.points.map((p) => xyOf(p.coordinate))
    expect(option.points).toHaveLength(5)
    expect(xy[1].x).toBeGreaterThan(1.5)
    expect(xy[2].y).toBeGreaterThan(2.5)
    expect(option.points[3].coordinate).toEqual(stop)
    // The budget is the requested route's straight length, its stop included, plus 5 km: 4.24 + 3 + 5.
    expect(pickScienceStops({ departure: START, destination: at(3, 0), stops: [stop] }, UNITS).budgetKm).toBeCloseTo(12.24, 1)
  })

  it('says it is being planned before its search, and again when cancelled', async () => {
    expect(scientific.plan(request(3, 3)).path).toEqual({ classification: 'UNAVAILABLE', reason: SEARCH_PENDING_REASON })
    const controller = new AbortController()
    controller.abort()
    const cancelled = await planScientific(request(3, 3), fixtureTerrain(() => 0, { units: UNITS }), controller.signal)
    expect(cancelled.path).toEqual({ classification: 'UNAVAILABLE', reason: SEARCH_PENDING_REASON })
  })
})
