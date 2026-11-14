import { describe, expect, it } from 'vitest'
import { isAvailable, type RouteOption, type RouteRequest } from '../../src/domain'
import { walkingKcalPerKm } from '../../src/features/route-analysis/metabolicCost'
import { MIN_KCAL_PER_KM, energyEfficient, energyStepKcal, planEnergyEfficient } from '../../src/features/route-analysis/strategies/energyEfficient'
import { planFastest } from '../../src/features/route-analysis/strategies/fastest'
import { SEARCH_PENDING_REASON } from '../../src/features/route-analysis/strategies/searchedRoute'
import { at, fixtureTerrain, xyOf } from './terrain.helpers'

const signal = new AbortController().signal
const request = (end: [number, number] = [1, 0], stops: [number, number][] = []): RouteRequest => ({
  departure: at(0, 0),
  destination: at(...end),
  stops: stops.map(([x, y]) => at(x, y)),
})
const flat = () => 0

function drawn(option: RouteOption) {
  if (!isAvailable(option.path) || !isAvailable(option.metrics.distanceKm) || !isAvailable(option.metrics.durationHours) || !isAvailable(option.metrics.metabolicEnergyKcal)) {
    throw new Error(`Not drawn: ${!isAvailable(option.path) ? option.path.reason : 'metric missing'}`)
  }
  return {
    xy: option.path.value.map((p) => xyOf(p.coordinate)),
    km: option.metrics.distanceKm.value,
    hours: option.metrics.durationHours.value,
    kcal: option.metrics.metabolicEnergyKcal.value,
    method: option.path.classification === 'DERIVED' ? option.path.method : '',
    kcalMethod: option.metrics.metabolicEnergyKcal.classification === 'DERIVED' ? option.metrics.metabolicEnergyKcal.method : '',
  }
}

describe('energy-efficient plan() before the search', () => {
  it('is no longer an unbuilt strategy: it says the route is being planned', () => {
    const option = energyEfficient.plan(request())
    expect(option.path).toEqual({ classification: 'UNAVAILABLE', reason: SEARCH_PENDING_REASON })
    expect(option.metrics.metabolicEnergyKcal).toEqual({ classification: 'UNAVAILABLE', reason: SEARCH_PENDING_REASON })
    expect(energyEfficient.planOnTerrain).toBe(planEnergyEfficient)
    expect(energyEfficient.objective).toMatch(/metabolic/)
    expect(energyEfficient.requires.join(' ')).toMatch(/Minetti et al\. \(2002\)/)
  })

  it('costs a step in kilocalories, never free downhill, and refuses the slope limit', () => {
    expect(energyStepKcal(1, 0)).toBeCloseTo(walkingKcalPerKm(0), 9)
    expect(energyStepKcal(1, -0.15)).toBeGreaterThan(0)
    expect(energyStepKcal(1, -0.15)).toBeLessThan(energyStepKcal(1, 0))
    expect(energyStepKcal(1, 0.2)).toBeGreaterThan(energyStepKcal(1, 0))
    expect(energyStepKcal(1, 0.37)).toBe(Number.POSITIVE_INFINITY)
    expect(MIN_KCAL_PER_KM).toBeLessThanOrEqual(energyStepKcal(1, -0.15))
  })
})

describe('planEnergyEfficient on a fixture DEM', () => {
  it('agrees with the fastest route on flat ground, and prices the kilometre', async () => {
    const terrain = fixtureTerrain(flat)
    const energy = drawn(await planEnergyEfficient(request(), terrain, signal))
    const fastest = drawn(await planFastest(request(), terrain, signal))
    expect(energy.xy).toEqual(fastest.xy)
    expect(energy.km).toBeCloseTo(fastest.km, 9)
    expect(energy.hours).toBeCloseTo(fastest.hours, 9)
    expect(energy.kcal).toBeCloseTo(fastest.kcal, 9)
    expect(energy.kcal).toBeCloseTo(energy.km * walkingKcalPerKm(0), 6)
    expect(energy.method).toMatch(/Each step costs its length times the metabolic cost of walking its slope/)
    expect(energy.method).toMatch(/Minetti.*2002/)
    expect(energy.kcalMethod).toMatch(/76\.43 kg/)
    expect(fastest.method).toMatch(/Each step costs its length over the walking speed for its slope/)
  })

  /** A ridge `heightM` high across x = 0.5 km, 400 m wide, between y = −0.49 and 0.49 km; its edges off the lattice's lines. */
  const ridge = (heightM: number) => (x: number, y: number) =>
    Math.abs(x - 0.5) < 0.2 && Math.abs(y) < 0.49 ? heightM * (1 - Math.abs(x - 0.5) / 0.2) : 0
  /** What the model says the straight line over the ridge costs, kcal, sampled every 20 m. */
  const straightOverKcal = (z: (x: number, y: number) => number) => {
    let kcal = 0
    for (let k = 1; k <= 50; k++) {
      const riseKm = (z(k / 50, 0) - z((k - 1) / 50, 0)) / 1000
      kcal += Math.hypot(0.02, riseKm) * walkingKcalPerKm(riseKm / 0.02)
    }
    return kcal
  }
  const widest = (xy: { x: number; y: number }[]) => Math.max(...xy.map((p) => Math.abs(p.y)))

  it('takes the longer, flatter way round a climbable ridge when the model says it is cheaper, where time still goes over', async () => {
    // 60 m up and down over 200 m each way, about 17°: round the end is 0.6 km longer, cheaper in energy, slower in time.
    const steep = ridge(60)
    const terrain = fixtureTerrain(steep)
    const energy = drawn(await planEnergyEfficient(request(), terrain, signal))
    const fastest = drawn(await planFastest(request(), terrain, signal))
    expect(widest(energy.xy)).toBeGreaterThan(0.45)
    expect(widest(fastest.xy)).toBeLessThan(0.3)
    expect(energy.km).toBeGreaterThan(1.4)
    expect(energy.kcal).toBeLessThan(straightOverKcal(steep))
    expect(energy.kcal).toBeLessThan(fastest.kcal)
    expect(energy.hours).toBeGreaterThan(fastest.hours)
    expect(energy.kcal).toBeGreaterThan(energy.km * MIN_KCAL_PER_KM)
  })

  it('goes over a low ridge when that is cheaper than the way round', async () => {
    // 20 m over 200 m each way, about 6°: the climb costs less than half a kilometre more of level ground.
    const low = ridge(20)
    const { xy, km, kcal } = drawn(await planEnergyEfficient(request(), fixtureTerrain(low), signal))
    expect(widest(xy)).toBeLessThan(0.3)
    expect(km).toBeLessThan(1.1)
    expect(kcal).toBeCloseTo(straightOverKcal(low), 0)
  })

  it('never prices a descent as free: downhill costs kilocalories too', async () => {
    const down = (x: number) => -100 * x // 100 m down over 1 km, about −5.7°
    const { kcal } = drawn(await planEnergyEfficient(request(), fixtureTerrain(down), signal))
    expect(kcal).toBeGreaterThan(0)
    expect(kcal).toBeLessThan(drawn(await planEnergyEfficient(request(), fixtureTerrain(flat), signal)).kcal)
  })

  it('names the failing leg and leaves every figure UNAVAILABLE with the reason', async () => {
    const option = await planEnergyEfficient(request([1, 1], [[1, 0]]), fixtureTerrain((x) => (x > 0.5 ? Number.NaN : 0)), signal)
    expect(isAvailable(option.path)).toBe(false)
    if (isAvailable(option.path)) return
    expect(option.path.reason).toMatch(/^Leg 1 of 2: No elevation model has a height at the destination/)
    expect(option.metrics.metabolicEnergyKcal).toEqual({ classification: 'UNAVAILABLE', reason: option.path.reason })
  })
})
