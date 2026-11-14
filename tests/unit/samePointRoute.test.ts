import { describe, expect, it } from 'vitest'
import { isAvailable, type MarsCoordinate, type RouteOption, type RouteRequest } from '../../src/domain'
import { planEnergyEfficient } from '../../src/features/route-analysis/strategies/energyEfficient'
import { planFastest } from '../../src/features/route-analysis/strategies/fastest'
import { SAME_POINT_REASON } from '../../src/features/route-analysis/strategies/searchedRoute'
import { at, fixtureTerrain } from './terrain.helpers'

/**
 * A leg from a point to itself: searched, its level joins out to the
 * nearest lattice node and back were priced as a walk of up to a cell, so
 * a route to where you stand read as 10 m and 0.5 kcal.
 */

const signal = new AbortController().signal
const flat = () => 0
const req = (departure: MarsCoordinate, stops: MarsCoordinate[], destination: MarsCoordinate): RouteRequest => ({
  departure,
  stops,
  destination,
})

const PLANNERS = [
  ['fastest', planFastest],
  ['energy-efficient', planEnergyEfficient],
] as const

function figures(option: RouteOption) {
  if (!isAvailable(option.path) || !isAvailable(option.metrics.distanceKm) || !isAvailable(option.metrics.durationHours)) {
    throw new Error(`Not drawn: ${isAvailable(option.path) ? 'a figure is missing' : option.path.reason}`)
  }
  return {
    path: option.path.value.map((p) => p.coordinate),
    km: option.metrics.distanceKm.value,
    hours: option.metrics.durationHours.value,
  }
}

describe.each(PLANNERS)('%s with waypoints at the same point', (_name, plan) => {
  it('says there is no route to walk, with no figures and no height read', async () => {
    const terrain = fixtureTerrain(flat)
    const option = await plan(req(at(0.3, 0.2), [], at(0.3, 0.2)), terrain, signal)
    const none = { classification: 'UNAVAILABLE', reason: SAME_POINT_REASON }
    expect(option.path).toEqual(none)
    expect(option.metrics).toEqual({ distanceKm: none, durationHours: none, metabolicEnergyKcal: none })
    expect(terrain.reads).toEqual([])
    // The waypoints are still the ones asked for, so the picker can show where.
    expect(option.points.map((p) => p.coordinate)).toEqual([at(0.3, 0.2), at(0.3, 0.2)])
  })

  it('says the same when every stop is that point too', async () => {
    const p = at(0.3, 0.2)
    const option = await plan(req(p, [p, p], p), fixtureTerrain(flat), signal)
    expect(option.path).toEqual({ classification: 'UNAVAILABLE', reason: SAME_POINT_REASON })
  })

  it('takes one place on both sides of 0°E as the same point', async () => {
    const option = await plan(req({ latitude: 0, longitudeEast: 0 }, [], { latitude: 0, longitudeEast: 360 }), fixtureTerrain(flat), signal)
    expect(option.path).toEqual({ classification: 'UNAVAILABLE', reason: SAME_POINT_REASON })
  })

  it('prices a stop repeated next to the departure or the destination as no extra walk', async () => {
    const direct = figures(await plan(req(at(0, 0), [], at(1, 0)), fixtureTerrain(flat), signal))
    for (const stops of [[at(0, 0)], [at(1, 0)], [at(0, 0), at(0, 0), at(1, 0)]]) {
      const repeated = figures(await plan(req(at(0, 0), stops, at(1, 0)), fixtureTerrain(flat), signal))
      expect(repeated.km).toBe(direct.km)
      expect(repeated.hours).toBe(direct.hours)
      expect(repeated.path).toEqual(direct.path)
    }
  })

  it('still searches a real leg however short, and a loop back to the start', async () => {
    const short = figures(await plan(req(at(0, 0), [], at(0.001, 0)), fixtureTerrain(flat), signal))
    expect(short.km).toBeGreaterThan(0)
    const loop = figures(await plan(req(at(0, 0), [at(0.5, 0)], at(0, 0)), fixtureTerrain(flat), signal))
    expect(loop.km).toBeCloseTo(1, 1)
  })

  it("numbers a leg whose map lines were not checked as the user listed them, counting the skipped one", async () => {
    const option = await plan(req(at(0, 0), [at(0, 0)], at(1, 0)), fixtureTerrain(flat, { mapFails: 'Map service down' }), signal)
    const method = option.path.classification === 'DERIVED' ? option.path.method : ''
    expect(method).toMatch(/Mapped lines were not kept off the path \(leg 2: Map service down\)/)
  })

  it('numbers a failed leg as the user listed them, counting the skipped one', async () => {
    const option = await plan(req(at(0, 0), [at(0, 0), at(1, 0)], at(2, 0)), fixtureTerrain((x) => (x > 1.5 ? Number.NaN : 0)), signal)
    expect(option.path.classification).toBe('UNAVAILABLE')
    expect(isAvailable(option.path) ? '' : option.path.reason).toMatch(/^Leg 3 of 3: No elevation model has a height at the destination/)
  })
})
