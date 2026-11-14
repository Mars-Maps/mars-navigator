import { describe, expect, it } from 'vitest'
import { SAMPLE_WALK_PLAN } from '../../src/data/mock/sampleWalkPlan'
import {
  HAZARD_NOT_CHECKED,
  MARS_MEAN_RADIUS_KM,
  derived,
  unavailable,
  type Hazard,
  type MarsCoordinate,
  type WalkPlan,
} from '../../src/domain'
import { niceScaleKm, walkMapLayout } from '../../src/features/mission-ui/walk/walkMap'

const W = 320
const H = 170
const PAD = 22
const KM_PER_DEG = (Math.PI * MARS_MEAN_RADIUS_KM) / 180

const stop = (i: number, coordinate: MarsCoordinate): WalkPlan['stops'][number] => ({
  ...SAMPLE_WALK_PLAN.stops[0],
  id: `s${i}`,
  coordinate,
})
const flag = (id: string, coordinate: MarsCoordinate, over: Partial<Hazard> = {}) =>
  ({ id, kind: 'slope', unit: 'deg', coordinate, magnitude: derived(25, 'test'), ...over }) as Hazard

/** A two-stop plan: `to` from `from`, with these flags on the leg. */
const plan = (from: MarsCoordinate, to: MarsCoordinate, hazards: Hazard[] = []): WalkPlan => ({
  ...SAMPLE_WALK_PLAN,
  stops: [stop(0, from), stop(1, to)],
  legs: [
    {
      ...SAMPLE_WALK_PLAN.legs[0],
      fromStopId: 's0',
      toStopId: 's1',
      path: derived([from, to], 'straight, test'),
      steepestSlopeDeg: derived(10, 'test'),
      hazards: derived(hazards, 'test'),
    },
  ],
})

describe('walkMapLayout', () => {
  it('puts north up and east right', () => {
    const north = walkMapLayout(plan({ latitude: 18, longitudeEast: 77 }, { latitude: 18.05, longitudeEast: 77 }), W, H, PAD)
    expect(north.stops[1].y).toBeLessThan(north.stops[0].y)
    const east = walkMapLayout(plan({ latitude: 18, longitudeEast: 77 }, { latitude: 18, longitudeEast: 77.05 }), W, H, PAD)
    expect(east.stops[1].x).toBeGreaterThan(east.stops[0].x)
  })

  it('keeps every point inside the padding, flags included', () => {
    const out = { latitude: 18.2, longitudeEast: 76.9 }
    const { stops, flags, legs } = walkMapLayout(
      plan({ latitude: 18, longitudeEast: 77 }, { latitude: 18.05, longitudeEast: 77.05 }, [flag('f', out)]),
      W,
      H,
      PAD,
    )
    for (const p of [...stops, ...flags, ...legs.flatMap((leg) => leg.points)]) {
      expect(p.x).toBeGreaterThanOrEqual(PAD - 1e-9)
      expect(p.x).toBeLessThanOrEqual(W - PAD + 1e-9)
      expect(p.y).toBeGreaterThanOrEqual(PAD - 1e-9)
      expect(p.y).toBeLessThanOrEqual(H - PAD + 1e-9)
    }
  })

  it('uses one scale on both axes, and the scale bar is true to it', () => {
    const a = { latitude: 0, longitudeEast: 10 }
    const b = { latitude: 0.1, longitudeEast: 10.1 }
    const { stops, scale } = walkMapLayout(plan(a, b), W, H, PAD)
    const dx = Math.abs(stops[1].x - stops[0].x)
    const dy = Math.abs(stops[1].y - stops[0].y)
    expect(dx).toBeCloseTo(dy, 2)
    expect(scale.length / scale.km).toBeCloseTo(dy / (0.1 * KM_PER_DEG), 6)
  })

  it('keeps a walk across 0°E together', () => {
    const { stops } = walkMapLayout(plan({ latitude: 0, longitudeEast: 359.99 }, { latitude: 0, longitudeEast: 0.01 }), W, H, PAD)
    expect(stops[1].x).toBeGreaterThan(stops[0].x)
    const span = stops[1].x - stops[0].x
    expect(span).toBeLessThanOrEqual(W - 2 * PAD + 1e-9)
    // 0.02° of longitude, not 359.98°.
    const { scale } = walkMapLayout(plan({ latitude: 0, longitudeEast: 359.99 }, { latitude: 0, longitudeEast: 0.01 }), W, H, PAD)
    expect(scale.km).toBeLessThan(2)
  })

  it('draws a plan whose stops coincide, without dividing by zero', () => {
    const c = { latitude: 18, longitudeEast: 77 }
    const { stops, scale } = walkMapLayout(plan(c, c), W, H, PAD)
    expect(stops[0]).toEqual({ x: W / 2, y: H / 2 })
    expect(Number.isFinite(scale.length)).toBe(true)
    expect(scale.length).toBeGreaterThan(0)
  })

  it('draws no line for a leg with no path, and keeps its stops', () => {
    const base = plan({ latitude: 18, longitudeEast: 77 }, { latitude: 18.05, longitudeEast: 77 })
    const noPath: WalkPlan = { ...base, legs: [{ ...base.legs[0], path: unavailable('no path, test') }] }
    const { legs, stops } = walkMapLayout(noPath, W, H, PAD)
    expect(legs).toEqual([])
    expect(stops.length).toBe(2)
  })

  it('marks slope figures and mapped obstacles, never a flag with no place', () => {
    const at = { latitude: 18.01, longitudeEast: 77.01 }
    const { flags } = walkMapLayout(
      plan({ latitude: 18, longitudeEast: 77 }, { latitude: 18.05, longitudeEast: 77.05 }, [
        flag('steep', at),
        flag('ridge', at, { kind: 'mapped-obstacle', unit: 'Ridge crest', magnitude: unavailable('no size') }),
        flag('slope-unread', at, { magnitude: unavailable('no height') }),
        flag('map-unread', at, { kind: 'mapped-obstacle', unit: HAZARD_NOT_CHECKED, magnitude: unavailable('no map') }),
      ]),
      W,
      H,
      PAD,
    )
    expect(flags.map((f) => [f.id, f.kind])).toEqual([
      ['steep', 'slope'],
      ['ridge', 'obstacle'],
    ])
  })

  it('leaves out flags when the leg has no hazard list', () => {
    const base = plan({ latitude: 18, longitudeEast: 77 }, { latitude: 18.05, longitudeEast: 77 })
    const unread: WalkPlan = { ...base, legs: [{ ...base.legs[0], hazards: unavailable('not read, test') }] }
    expect(walkMapLayout(unread, W, H, PAD).flags).toEqual([])
  })
})

describe('walkMapLayout: a leg not fully checked', () => {
  const FROM = { latitude: 18, longitudeEast: 77 }
  const TO = { latitude: 18.05, longitudeEast: 77.05 }
  const checked = (p: WalkPlan) => walkMapLayout(p, W, H, PAD).legs[0].notFullyChecked
  const at = { latitude: 18.01, longitudeEast: 77.01 }

  it('is clear only when the slope and the map were read, flags or not', () => {
    expect(checked(plan(FROM, TO))).toBe(false)
    expect(checked(plan(FROM, TO, [flag('steep', at)]))).toBe(false)
    expect(
      checked(plan(FROM, TO, [flag('ridge', at, { kind: 'mapped-obstacle', unit: 'Ridge crest', magnitude: unavailable('no size') })])),
    ).toBe(false)
  })

  it('says so for a slope or a map not checked', () => {
    expect(checked(plan(FROM, TO, [flag('slope', at, { magnitude: unavailable('no height') })]))).toBe(true)
    expect(
      checked(plan(FROM, TO, [flag('map', at, { kind: 'mapped-obstacle', unit: HAZARD_NOT_CHECKED, magnitude: unavailable('no map') })])),
    ).toBe(true)
  })

  it('says so with no flag list or no steepest slope', () => {
    const base = plan(FROM, TO)
    expect(checked({ ...base, legs: [{ ...base.legs[0], hazards: unavailable('not read') }] })).toBe(true)
    expect(checked({ ...base, legs: [{ ...base.legs[0], steepestSlopeDeg: unavailable('not read') }] })).toBe(true)
  })
})

describe('niceScaleKm', () => {
  it('gives the largest 1, 2 or 5 × 10ⁿ not over the length', () => {
    expect(niceScaleKm(1.3)).toBeCloseTo(1)
    expect(niceScaleKm(2.7)).toBeCloseTo(2)
    expect(niceScaleKm(7)).toBeCloseTo(5)
    expect(niceScaleKm(0.3)).toBeCloseTo(0.2)
    expect(niceScaleKm(10)).toBeCloseTo(10)
  })
})
