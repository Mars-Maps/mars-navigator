import { describe, expect, it } from 'vitest'
import { SUITED_SLOPE_LIMIT, isAvailable, type GeologicUnitArea, type RouteOption } from '../../src/domain'
import { planEnergyEfficient } from '../../src/features/route-analysis/strategies/energyEfficient'
import { planFastest } from '../../src/features/route-analysis/strategies/fastest'
import { planScientific } from '../../src/features/route-analysis/strategies/scientific'
import { keptOffBySearch, pendingOption } from '../../src/features/route-analysis/strategies/searchedRoute'
import { shortest } from '../../src/features/route-analysis/strategies/shortest'
import { MAP, START, at, fixtureTerrain } from './terrain.helpers'

/**
 * What a searched route kept off its path, for the hazards panel's
 * slope and mapped-obstacle rows: the search's own rule, in the words of the
 * path's method, and nothing where the search did not run or the map was
 * not read.
 */

const signal = new AbortController().signal
const flat = () => 0
const request = { departure: at(0, 0), stops: [], destination: at(1, 0) }
const methodOf = (o: RouteOption) => (o.path.classification === 'DERIVED' ? o.path.method : '')

// Test fixtures only: one invented unit square, named as SIM 3464 names a unit so a science goal matches it.
const FAN1: GeologicUnitArea = {
  unit: { symbol: 'Jf1', name: 'Jezero fan 1 unit', map: MAP },
  rings: [[at(1.5, -0.5), at(2.5, -0.5), at(2.5, 0.5), at(1.5, 0.5), at(1.5, -0.5)]],
}

describe('keptOffBySearch', () => {
  it.each([
    ['fastest', () => planFastest(request, fixtureTerrain(flat), signal)],
    ['energy-efficient', () => planEnergyEfficient(request, fixtureTerrain(flat), signal)],
    ['scientific', () => planScientific({ departure: START, stops: [], destination: at(3, 0) }, fixtureTerrain(flat, { units: [FAN1] }), signal)],
  ])('names the slope limit and the mapped lines for a %s route, as its method does', async (_name, plan) => {
    const option = await plan()
    expect(isAvailable(option.path)).toBe(true)
    const kept = keptOffBySearch(option)
    expect(kept.slope).toBe(`Steps over ${SUITED_SLOPE_LIMIT.deg}° (${SUITED_SLOPE_LIMIT.label}; ${SUITED_SLOPE_LIMIT.source}) are not walked`)
    expect(kept['mapped-obstacle']).toMatch(/^Steps crossing a line the map marks as .* are not walked; small craters and ridged ground are not avoided$/)
    // The panel's words are the method's, so the two never disagree.
    expect(methodOf(option)).toContain(kept['mapped-obstacle'])
    expect(methodOf(option).toLowerCase()).toContain(kept.slope?.toLowerCase())
  })

  it('claims no mapped lines kept off where the map was not read, and still the slope limit', async () => {
    const option = await planFastest(request, fixtureTerrain(flat, { mapFails: 'fixture map down' }), signal)
    expect(methodOf(option)).toMatch(/Mapped lines were not kept off the path \(leg 1: /)
    expect(keptOffBySearch(option)).toEqual({ slope: expect.stringMatching(/^Steps over 20° /) })
  })

  it('says nothing for a route that was not searched', async () => {
    // Shortest is a straight line through the waypoints: no slope or line was avoided.
    expect(keptOffBySearch(shortest.plan(request))).toEqual({})
    expect(keptOffBySearch(pendingOption('fastest', request))).toEqual({})
    // A search that found no path.
    const none = await planFastest(request, fixtureTerrain(() => Number.NaN), signal)
    expect(none.path.classification).toBe('UNAVAILABLE')
    expect(keptOffBySearch(none)).toEqual({})
  })
})
