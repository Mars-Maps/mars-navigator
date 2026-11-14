import { describe, expect, it } from 'vitest'
import {
  MARS_MEAN_RADIUS_KM,
  type GeologicMap,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type ScienceGoal,
  type WalkStop,
} from '../../src/domain'
import { candidateStops, DEFAULT_MAX_STOPS, SCIENCE_GOALS } from '../../src/features/route-analysis/scienceGoals'
import { surfaceDistanceKm } from '../../src/features/route-analysis/routeDistance'
import { SIM_3464_UNIT_NAMES } from '../fixtures/sim3464UnitNames'

// Test fixtures only: invented polygons near Jezero, never shown in the app.
const MAP: GeologicMap = {
  id: 'SIM 3464',
  title: 'Fixture map',
  scaleDenominator: 75000,
  citation: 'Fixture citation',
}
const unit = (name: string, extra: Partial<GeologicUnit> = {}): GeologicUnit => ({
  symbol: name.slice(0, 3),
  name,
  interpretation: `Fixture interpretation of ${name}. A second sentence.`,
  map: MAP,
  ...extra,
})

const START: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const RAD = Math.PI / 180
const KM_PER_DEG_LAT = MARS_MEAN_RADIUS_KM * RAD

/** A point `x` km east and `y` km north of `origin`, 0–360°E. */
function at(origin: MarsCoordinate, x: number, y: number): MarsCoordinate {
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos(origin.latitude * RAD)
  return {
    latitude: origin.latitude + y / KM_PER_DEG_LAT,
    longitudeEast: (((origin.longitudeEast + x / kmPerDegLon) % 360) + 360) % 360,
  }
}
/** `c` as km east and north of `origin`, wrapping across 0/360°E. */
function km(origin: MarsCoordinate, c: MarsCoordinate) {
  const kmPerDegLon = KM_PER_DEG_LAT * Math.cos(origin.latitude * RAD)
  const dLon = ((((c.longitudeEast - origin.longitudeEast) % 360) + 540) % 360) - 180
  return { x: dLon * kmPerDegLon, y: (c.latitude - origin.latitude) * KM_PER_DEG_LAT }
}
/** A rectangle ring, km offsets from `origin`. */
const box = (x0: number, y0: number, x1: number, y1: number, origin = START): MarsCoordinate[] => [
  at(origin, x0, y0),
  at(origin, x1, y0),
  at(origin, x1, y1),
  at(origin, x0, y1),
]
const area = (name: string, ...rings: MarsCoordinate[][]): GeologicUnitArea => ({ unit: unit(name), rings })

/** Even-odd point in polygon, worked in km around `origin`. */
function inside(c: MarsCoordinate, rings: MarsCoordinate[][], origin = START): boolean {
  const p = km(origin, c)
  let isIn = false
  for (const ring of rings.map((r) => r.map((q) => km(origin, q)))) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]
      const b = ring[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) isIn = !isIn
    }
  }
  return isIn
}

const GOAL: ScienceGoal = {
  id: 'fixture-goal',
  label: 'Fixture goal',
  unitNames: ['Fan unit'],
  reason: { classification: 'DERIVED', value: 'fixture', method: 'fixture' },
}
const unitName = (s: WalkStop) => (s.unit.classification === 'OFFICIAL' ? s.unit.value.name : null)

describe('candidateStops', () => {
  it('returns stops only inside the goal\'s units, each with its unit and quoted reason', () => {
    const fan = area('Fan unit', box(1, -0.5, 2, 0.5))
    const fanFar = area('Fan unit', box(-2, 2, -1, 3))
    const floor = area('Floor unit', box(-0.5, 0.8, 0.5, 1.2))
    const stops = candidateStops(GOAL, START, [floor, fan, fanFar])

    expect(stops[0].label).toBe('Start')
    expect(stops[0].coordinate).toEqual(START)
    const after = stops.slice(1)
    expect(after).toHaveLength(2)
    for (const s of after) {
      expect(unitName(s)).toBe('Fan unit')
      expect(s.unit.classification).toBe('OFFICIAL')
      expect(inside(s.coordinate, fan.rings) || inside(s.coordinate, fanFar.rings)).toBe(true)
      expect(inside(s.coordinate, floor.rings)).toBe(false)
      expect(s.reason.classification).toBe('DERIVED')
      expect(s.reason.classification === 'DERIVED' && s.reason.value).toBe(
        'Fan unit: "Fixture interpretation of Fan unit."',
      )
      expect(s.reason.classification === 'DERIVED' && s.reason.method).toContain('SIM 3464')
    }
  })

  it('puts the stop at the unit\'s nearest edge, just inside it', () => {
    const fan = area('Fan unit', box(1, -0.5, 2, 0.5))
    const [, stop] = candidateStops(GOAL, START, [fan])
    const p = km(START, stop.coordinate)
    expect(p.x).toBeCloseTo(1.05, 3)
    expect(p.y).toBeCloseTo(0, 3)
  })

  it('names stops by goal and order, and labels them with their unit', () => {
    const stops = candidateStops(GOAL, START, [area('Fan unit', box(1, -0.5, 2, 0.5))])
    expect(stops.map((s) => s.id)).toEqual(['fixture-goal-1', 'fixture-goal-2'])
    // The start is "Start", so the first stop after it is Stop 1; the ids keep counting the start.
    expect(stops.map((s) => s.label)).toEqual(['Start', 'Stop 1 · Fan unit'])
  })

  it('leaves out units beyond the walking range', () => {
    const near = area('Fan unit', box(1, -0.5, 2, 0.5))
    const far = area('Fan unit', box(6, -0.5, 7, 0.5))
    expect(candidateStops(GOAL, START, [near, far])).toHaveLength(2)
    expect(candidateStops(GOAL, START, [near, far], { maxWalkKm: 0.5 })).toHaveLength(1)
    expect(candidateStops(GOAL, START, [near, far], { maxWalkKm: 10 })).toHaveLength(3)
  })

  it('keeps at most maxStops, the nearest ones, walked nearest-neighbour from the start', () => {
    const areas = [4, 1, 3, 2].map((x) => area('Fan unit', box(x, -0.2, x + 0.5, 0.2)))
    const stops = candidateStops(GOAL, START, areas)
    expect(stops).toHaveLength(1 + DEFAULT_MAX_STOPS)
    const xs = stops.slice(1).map((s) => km(START, s.coordinate).x)
    expect(xs.map((x) => Math.round(x))).toEqual([1, 2, 3])

    expect(candidateStops(GOAL, START, areas, { maxStops: 1 })).toHaveLength(2)
    expect(candidateStops(GOAL, START, areas, { maxStops: 0 })).toHaveLength(1)
  })

  it('every stop is within the range of the start', () => {
    const areas = [0.5, 1.5, 3, 4.9].map((x) => area('Fan unit', box(x, 1, x + 0.3, 1.3)))
    for (const s of candidateStops(GOAL, START, areas, { maxStops: 10 })) {
      expect(surfaceDistanceKm(START, s.coordinate)).toBeLessThanOrEqual(5)
    }
  })

  it('gives no stop for the unit the start stands in, and reports that unit for the start', () => {
    const under = area('Fan unit', box(-1, -1, 1, 1))
    const stops = candidateStops(GOAL, START, [under])
    expect(stops).toHaveLength(1)
    expect(stops[0].unit.classification).toBe('OFFICIAL')
    expect(unitName(stops[0])).toBe('Fan unit')
  })

  it('reports the start\'s unit as UNAVAILABLE when no unit covers it or none was read', () => {
    const away = candidateStops(GOAL, START, [area('Fan unit', box(1, 1, 2, 2))])[0]
    expect(away.unit).toEqual({
      classification: 'UNAVAILABLE',
      reason: 'No unit of the geologic map covers the start',
    })
    const none = candidateStops(GOAL, START, [])
    expect(none).toHaveLength(1)
    expect(none[0].unit).toEqual({ classification: 'UNAVAILABLE', reason: 'No geologic unit was read for the walk' })
  })

  it('never puts a stop in a hole of its unit', () => {
    // A ring of fan unit with the start in its hole: the nearest edge is the hole's.
    const donut = area('Fan unit', box(-2, -2, 2, 2), box(-0.5, -0.5, 0.5, 0.5))
    const stops = candidateStops(GOAL, START, [donut])
    expect(stops).toHaveLength(2)
    expect(stops[0].unit.classification).toBe('UNAVAILABLE')
    expect(inside(stops[1].coordinate, donut.rings)).toBe(true)
    expect(surfaceDistanceKm(START, stops[1].coordinate)).toBeLessThan(0.6)
  })

  it('finds a stop inside a concave unit open toward the start', () => {
    // A U open toward the start: the nearest boundary point is the tip of an arm.
    const u = area('Fan unit', [
      at(START, 1, -1),
      at(START, 3, -1),
      at(START, 3, 1),
      at(START, 1, 1),
      at(START, 1, 0.6),
      at(START, 2.5, 0.6),
      at(START, 2.5, -0.6),
      at(START, 1, -0.6),
    ])
    const [, stop] = candidateStops(GOAL, START, [u])
    expect(inside(stop.coordinate, u.rings)).toBe(true)
  })

  it('keeps a unit across 0/360°E in one piece', () => {
    const start: MarsCoordinate = { latitude: 0, longitudeEast: 0.001 }
    const across = area('Fan unit', box(-1, 1, 1, 2, start))
    expect(across.rings[0].some((c) => c.longitudeEast > 359)).toBe(true)
    const stops = candidateStops(GOAL, start, [across])
    expect(stops).toHaveLength(2)
    expect(inside(stops[1].coordinate, across.rings, start)).toBe(true)
    expect(km(start, stops[1].coordinate).y).toBeCloseTo(1.05, 3)
  })

  it('falls back to the middle of the widest span when no 50 m step from the nearest edge lands inside', () => {
    // A strip 40 m wide and 2 km tall: the step away from the start and both
    // steps across the nearest edge all land outside it.
    const sliver = area('Fan unit', box(1, -1, 1.04, 1))
    const [, stop] = candidateStops(GOAL, START, [sliver])
    expect(inside(stop.coordinate, sliver.rings)).toBe(true)
    const p = km(START, stop.coordinate)
    expect(p.x).toBeCloseTo(1.02, 3)
    expect(p.y).toBeCloseTo(0, 3)
  })

  it('skips rings with fewer than three points', () => {
    const broken: GeologicUnitArea = { unit: unit('Fan unit'), rings: [[at(START, 1, 0), at(START, 2, 0)]] }
    expect(candidateStops(GOAL, START, [broken])).toHaveLength(1)
  })

  it('quotes the description when the map gives no interpretation, and names the unit when neither', () => {
    const described: GeologicUnitArea = {
      unit: unit('Fan unit', { interpretation: undefined, description: 'Layered rock. More text.' }),
      rings: [box(1, -0.5, 2, 0.5)],
    }
    const [, a] = candidateStops(GOAL, START, [described])
    expect(a.reason.classification === 'DERIVED' && a.reason.value).toBe('Fan unit: "Layered rock."')

    const bare: GeologicUnitArea = {
      unit: unit('Fan unit', { interpretation: '  ', description: undefined }),
      rings: [box(1, -0.5, 2, 0.5)],
    }
    const [, b] = candidateStops(GOAL, START, [bare])
    expect(b.reason.classification === 'DERIVED' && b.reason.value).toBe(
      'Fan unit, a unit the goal "Fixture goal" visits',
    )
  })

  it('does not end the quoted sentence at an abbreviation', () => {
    const abbreviated: GeologicUnitArea = {
      unit: unit('Fan unit', { interpretation: 'Deposits of several kinds, e.g. Deltaic fans (Fig. 7). Second sentence.' }),
      rings: [box(1, -0.5, 2, 0.5)],
    }
    const [, s] = candidateStops(GOAL, START, [abbreviated])
    expect(s.reason.classification === 'DERIVED' && s.reason.value).toBe(
      'Fan unit: "Deposits of several kinds, e.g. Deltaic fans (Fig. 7)."',
    )
  })

  it('throws for a start that is not a coordinate or too near a pole', () => {
    expect(() => candidateStops(GOAL, { latitude: Number.NaN, longitudeEast: 0 }, [])).toThrow(/not a valid/)
    expect(() => candidateStops(GOAL, { latitude: 0, longitudeEast: 360 }, [])).toThrow(/not a valid/)
    expect(() => candidateStops(GOAL, { latitude: 86, longitudeEast: 10 }, [])).toThrow(/pole/)
  })
})

describe('SCIENCE_GOALS', () => {
  it('has unique ids and names at least one unit for every goal', () => {
    expect(new Set(SCIENCE_GOALS.map((g) => g.id)).size).toBe(SCIENCE_GOALS.length)
    for (const g of SCIENCE_GOALS) {
      expect(g.label.trim()).not.toBe('')
      expect(g.unitNames.length).toBeGreaterThan(0)
      for (const n of g.unitNames) expect(n.trim()).toBe(n)
    }
  })

  it('gives every goal a DERIVED reason that quotes and cites SIM 3464', () => {
    for (const g of SCIENCE_GOALS) {
      expect(g.reason.classification).toBe('DERIVED')
      if (g.reason.classification !== 'DERIVED') continue
      expect(g.reason.value).toMatch(/SIM 3464 .*"/)
      expect(g.reason.method).toContain('Scientific Investigations Map 3464')
    }
  })

  it('names only units the map has, spelled as the map spells them, every spelling of a unit', () => {
    const names = new Set(SIM_3464_UNIT_NAMES.map((u) => u.name))
    for (const g of SCIENCE_GOALS) {
      for (const n of g.unitNames) expect(names, `${g.id} names "${n}"`).toContain(n)
      // A goal that names one spelling of a unit names them all, or it misses polygons.
      const symbols = new Set(SIM_3464_UNIT_NAMES.filter((u) => g.unitNames.includes(u.name)).map((u) => u.symbol))
      for (const u of SIM_3464_UNIT_NAMES) {
        if (symbols.has(u.symbol)) expect(g.unitNames, `${g.id} lists every spelling of ${u.symbol}`).toContain(u.name)
      }
    }
    expect(SCIENCE_GOALS.flatMap((g) => g.unitNames)).toContain('Crater riim unit')
    expect(SCIENCE_GOALS.flatMap((g) => g.unitNames)).toContain('Crater rim unit')
  })
})
