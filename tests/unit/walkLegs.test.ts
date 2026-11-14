import { describe, expect, it } from 'vitest'
import {
  MARS_MEAN_RADIUS_KM,
  SUITED_SLOPE_LIMIT,
  derived,
  official,
  unavailable,
  type Classified,
  type GeologicFeatures,
  type GeologicLineFeature,
  type GeologicMap,
  type Hazard,
  type MarsCoordinate,
  type WalkLeg,
  type WalkStop,
} from '../../src/domain'
import { CRATER_NEAR_KM, segmentCrossing } from '../../src/features/route-analysis/mappedObstacles'
import { walkLegs, type WalkHeights } from '../../src/features/route-analysis/walkLegs'

// Test fixtures only: an invented DEM, stops and map lines near Jezero, never shown in the app.
const START: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const RAD = Math.PI / 180
const KM_PER_DEG_LAT = MARS_MEAN_RADIUS_KM * RAD
const KM_PER_DEG_LON = KM_PER_DEG_LAT * Math.cos(START.latitude * RAD)
const MAP: GeologicMap = { id: 'SIM 3464', title: 'Fixture map', scaleDenominator: 75000, citation: 'Fixture citation' }

const at = (x: number, y = 0): MarsCoordinate => ({
  latitude: START.latitude + y / KM_PER_DEG_LAT,
  longitudeEast: START.longitudeEast + x / KM_PER_DEG_LON,
})
const xOf = (c: MarsCoordinate) => (c.longitudeEast - START.longitudeEast) * KM_PER_DEG_LON
const stop = (id: string, x: number, y = 0): WalkStop => ({
  id,
  label: id,
  coordinate: at(x, y),
  unit: unavailable('fixture'),
  reason: derived('fixture', 'fixture'),
})

/** A fixture DEM of one model: height in metres from km east of the start; NaN for no data. */
function dem(z: (xKm: number) => number, cellKm = 0.2) {
  const calls: number[] = []
  const heights: WalkHeights = (points) => {
    calls.push(points.length / 2)
    const h = new Float32Array(points.length / 2)
    for (let i = 0; i < h.length; i++) {
      h[i] = z(xOf({ latitude: points[i * 2], longitudeEast: points[i * 2 + 1] }))
    }
    const models = [{ cellKm, source: 'fixture DEM', site: false }]
    return Promise.resolve(official({ heights: h, model: new Uint8Array(h.length), models }, 'fixture DEM'))
  }
  return { heights, calls }
}
const tanDeg = (deg: number) => Math.tan(deg * RAD)
/** A plane rising `deg` eastward from Gale's elevation, so even 2 km of 25° stays under the shielding warning. */
const ramp = (deg: number) => (x: number) => -4400 + x * 1000 * tanDeg(deg)
const CELL = () => 0.2
const live = () => new AbortController().signal
const RIDGE_CREST = 'ridge crest (type 1), certain'
const ridge = (x: number, y0: number, y1: number, kind = RIDGE_CREST): GeologicLineFeature => ({
  kind,
  path: [at(x, y0), at(x, y1)],
  map: MAP,
})

const mapOf = (features: Partial<GeologicFeatures> = {}): Classified<GeologicFeatures> =>
  official({ points: [], lines: [], areas: [], ...features }, 'Fixture citation')
const NO_FEATURES = mapOf()
/** A box on the map, km from the start, x0 to x1 east and y0 to y1 north. */
const box = (x0: number, x1: number, y0: number, y1: number): MarsCoordinate[] => [
  at(x0, y0),
  at(x1, y0),
  at(x1, y1),
  at(x0, y1),
  at(x0, y0),
]

async function oneLeg(z: (x: number) => number, lines: GeologicLineFeature[] = []): Promise<WalkLeg> {
  return legOver(z, mapOf({ lines }))
}
async function legOver(z: (x: number) => number, features: Classified<GeologicFeatures>): Promise<WalkLeg> {
  const [leg] = await walkLegs([stop('a', 0), stop('b', 2)], dem(z).heights, CELL, features, SUITED_SLOPE_LIMIT, live())
  return leg
}
/** The same 2 km leg on a 20 m model, whose baseline is 100 m. */
async function fineLeg(z: (x: number) => number): Promise<WalkLeg> {
  const [leg] = await walkLegs([stop('a', 0), stop('b', 2)], dem(z, 0.02).heights, () => 0.02, NO_FEATURES, SUITED_SLOPE_LIMIT, live())
  return leg
}
const value = (c: Classified<number>) => (c.classification === 'DERIVED' || c.classification === 'OFFICIAL' ? c.value : null)
const hazardsOf = (leg: WalkLeg): Hazard[] => (leg.hazards.classification === 'DERIVED' ? leg.hazards.value : [])

describe('walkLegs', () => {
  it('flags nothing on flat ground, and says so as a DERIVED empty list', async () => {
    const leg = await oneLeg(() => -2500)
    expect(leg.hazards.classification).toBe('DERIVED')
    expect(hazardsOf(leg)).toEqual([])
    expect(value(leg.steepestSlopeDeg)).toBe(0)
  })

  it('flags a known 25° slope, with its slope and position, citing the limit', async () => {
    const leg = await oneLeg(ramp(25))
    expect(value(leg.steepestSlopeDeg)).toBeCloseTo(25, 1)
    const hazards = hazardsOf(leg)
    // One run along the whole leg is one hazard, not one per stretch.
    expect(hazards).toHaveLength(1)
    expect(hazards[0].kind).toBe('slope')
    expect(hazards[0].unit).toBe('°')
    expect(value(hazards[0].magnitude)).toBeCloseTo(25, 1)
    expect(xOf(hazards[0].coordinate)).toBeGreaterThan(0)
    expect(xOf(hazards[0].coordinate)).toBeLessThan(2)
    expect(leg.hazards.classification === 'DERIVED' && leg.hazards.method).toContain('EVA-EXP-0075')
    expect(leg.hazards.classification === 'DERIVED' && leg.hazards.method).toContain('not a Mars requirement')
    // Shown on the walk's marks: no tracker number a reader cannot look up.
    expect(leg.hazards.classification === 'DERIVED' && leg.hazards.method).not.toMatch(/#\d/)
  })

  it('does not flag a 15° slope, and gives its steepest stretch with the spacing', async () => {
    const leg = await oneLeg(ramp(15))
    expect(hazardsOf(leg)).toEqual([])
    expect(value(leg.steepestSlopeDeg)).toBeCloseTo(15, 1)
    // 2 km on 200 m cells: 10 samples, so about 222 m apart, never finer than a cell.
    expect(leg.steepestSlopeDeg.classification === 'DERIVED' && leg.steepestSlopeDeg.method).toContain('222 m apart')
  })

  it('puts the hazard on a steep bank mid-leg, not along the whole leg', async () => {
    // Flat, a 30° bank from 0.6 to 1.4 km, flat again.
    const bank = (x: number) => -2500 + Math.min(Math.max(x - 0.6, 0), 0.8) * 1000 * tanDeg(30)
    const leg = await fineLeg(bank)
    const hazards = hazardsOf(leg)
    expect(hazards).toHaveLength(1)
    expect(xOf(hazards[0].coordinate)).toBeGreaterThan(0.6)
    expect(xOf(hazards[0].coordinate)).toBeLessThan(1.4)
    expect(value(hazards[0].magnitude)).toBeCloseTo(30, 1)
    // The run is the bank, give or take the 100 m a measurement spans.
    expect(hazards[0].magnitude.classification === 'DERIVED' && hazards[0].magnitude.method).toMatch(
      /from (5\d\d|6\d\d) m to 1\.[45] km along the leg/,
    )
  })

  it('averages out a step shorter than the baseline, and says so in the method', async () => {
    // A 100 m rise over 200 m is 26.6°, but a measurement over 1.1 km straddles it: the method warns of exactly this.
    const step = (x: number) => (x <= 1.0 ? -2500 : x >= 1.2 ? -2400 : -2500 + (x - 1.0) * 500)
    const leg = await oneLeg(step)
    expect(value(leg.steepestSlopeDeg)).toBeLessThan(26.6)
    expect(leg.steepestSlopeDeg.classification === 'DERIVED' && leg.steepestSlopeDeg.method).toMatch(
      /steeper ground shorter than 1\.1 km is averaged out/,
    )
  })

  it('makes missing heights a gap: a "not checked" hazard, never 0, and no steepest figure', async () => {
    const holey = (x: number) => (x > 0.5 && x < 0.9 ? Number.NaN : ramp(10)(x))
    const leg = await fineLeg(holey)
    const hazards = hazardsOf(leg).filter((h) => h.kind === 'slope')
    expect(hazards).toHaveLength(1)
    expect(hazards[0].magnitude.classification).toBe('UNAVAILABLE')
    expect(hazards[0].magnitude.classification === 'UNAVAILABLE' && hazards[0].magnitude.reason).toMatch(
      /not checked against 20°/,
    )
    expect(leg.steepestSlopeDeg.classification).toBe('UNAVAILABLE')
    expect(leg.steepestSlopeDeg.classification === 'UNAVAILABLE' && leg.steepestSlopeDeg.reason).toMatch(
      /not checked \(no elevation model has a height there\).*steepest measured stretch is 10\.0°/,
    )
    const radiation = hazardsOf(leg).filter((h) => h.kind === 'radiation')
    expect(radiation).toHaveLength(1)
    expect(xOf(radiation[0].coordinate)).toBeGreaterThan(0.5)
    expect(xOf(radiation[0].coordinate)).toBeLessThan(0.6)
    expect(radiation[0].magnitude.classification === 'UNAVAILABLE' && radiation[0].magnitude.reason).toMatch(
      /^No height from .* along the leg, so the shielding there was not checked$/,
    )
  })

  // `walkMap`'s `isNotFullyChecked` reads the slope's "not checked" and not the radiation's: this is what makes that safe.
  it.each([
    ['one sample mid-leg', (x: number) => x > 1 && x < 1.015],
    ['the first samples', (x: number) => x < 0.01],
    ['the last samples', (x: number) => x > 1.99],
    ['the whole leg', () => true],
  ])('never leaves a height gap unchecked for radiation but clear for slope: %s', async (_name, hole) => {
    const leg = await fineLeg((x) => (hole(x) ? Number.NaN : ramp(10)(x)))
    const hazards = hazardsOf(leg)
    expect(hazards.some((h) => h.kind === 'radiation' && h.magnitude.classification === 'UNAVAILABLE')).toBe(true)
    expect(hazards.some((h) => h.kind === 'slope' && h.magnitude.classification === 'UNAVAILABLE')).toBe(true)
  })

  it('says a failed read left the slope unchecked, keeping the mapped obstacles, path and distance', async () => {
    const failed: WalkHeights = () => Promise.resolve(unavailable('fixture: the DEM did not load'))
    const features = mapOf({ lines: [ridge(1.3, -0.5, 0.5)] })
    const [leg] = await walkLegs([stop('a', 0), stop('b', 2)], failed, CELL, features, SUITED_SLOPE_LIMIT, live())
    expect(leg.steepestSlopeDeg).toEqual(unavailable('fixture: the DEM did not load'))
    const [slope, radiation, crossing] = hazardsOf(leg)
    expect(slope.kind).toBe('slope')
    expect(radiation.kind).toBe('radiation')
    expect(radiation.magnitude).toEqual(unavailable('The shielding was not checked: fixture: the DEM did not load'))
    expect(slope.magnitude).toEqual(unavailable('The slope was not checked: fixture: the DEM did not load'))
    expect(crossing.unit).toBe(RIDGE_CREST)
    expect(leg.path.classification).toBe('DERIVED')
    expect(value(leg.distanceKm)).toBeCloseTo(2, 3)
  })

  it('flags a route crossing a mapped ridge crest, in the map\'s wording, citing the map', async () => {
    const leg = await oneLeg(() => -2500, [ridge(1.3, -0.5, 0.5)])
    const [h] = hazardsOf(leg)
    expect(h.kind).toBe('mapped-obstacle')
    expect(h.unit).toBe(RIDGE_CREST)
    expect(xOf(h.coordinate)).toBeCloseTo(1.3, 3)
    expect(h.magnitude.classification === 'UNAVAILABLE' && h.magnitude.reason).toContain('SIM 3464 (Fixture citation)')
    expect(leg.hazards.classification === 'DERIVED' && leg.hazards.method).toContain('from Fixture citation')
  })

  it('does not flag a mapped line beside the route, and an empty map is a clean DERIVED list', async () => {
    const beside = await oneLeg(() => -2500, [ridge(1.3, 0.2, 0.9), ridge(3, -1, 1)])
    expect(hazardsOf(beside)).toEqual([])
    const none = await oneLeg(() => -2500)
    expect(none.hazards.classification).toBe('DERIVED')
    expect(hazardsOf(none)).toEqual([])
  })

  it('flags only the obstacle kinds, not channels, lineaments or buried craters', async () => {
    const kinds = ['channel (fluvial)', 'lineament', 'crest of buried crater']
    const leg = await oneLeg(() => -2500, kinds.map((k) => ridge(1, -1, 1, k)))
    expect(hazardsOf(leg)).toEqual([])
    const named = ['crest of crater rim', 'delta lobe front', RIDGE_CREST]
    const flagged = await oneLeg(() => -2500, named.map((k, i) => ridge(0.5 + i * 0.5, -1, 1, k)))
    expect(hazardsOf(flagged).map((h) => h.unit)).toEqual(named)
  })

  it('never reads an unread map as a clear one: a "not checked" hazard, the slope kept', async () => {
    const leg = await legOver(ramp(25), unavailable('fixture: the service is down'))
    const [slope, unread] = hazardsOf(leg)
    expect(slope.kind).toBe('slope')
    expect(unread.kind).toBe('mapped-obstacle')
    expect(unread.unit).toBe('not checked')
    expect(unread.magnitude.classification === 'UNAVAILABLE' && unread.magnitude.reason).toMatch(
      /not checked: fixture: the service is down/,
    )
  })

  it('flags a small crater within the stated distance of the leg, at the crater, and not one beyond it', async () => {
    const small = (x: number, y: number) => ({ kind: 'small crater', at: at(x, y), map: MAP })
    const nearKm = CRATER_NEAR_KM - 0.02
    const leg = await legOver(() => -2500, mapOf({ points: [small(1, nearKm), small(1, CRATER_NEAR_KM + 0.02)] }))
    const hazards = hazardsOf(leg)
    expect(hazards).toHaveLength(1)
    expect(hazards[0].unit).toBe('small crater')
    expect(xOf(hazards[0].coordinate)).toBeCloseTo(1, 6)
    const reason = hazards[0].magnitude.classification === 'UNAVAILABLE' ? hazards[0].magnitude.reason : ''
    expect(reason).toContain('about 80 m from the leg')
    expect(reason).toContain('SIM 3464 (Fixture citation)')
    expect(reason).toContain('a project choice')
    expect(leg.hazards.classification === 'DERIVED' && leg.hazards.method).toContain('within 100 m of the leg')
  })

  it('measures a crater past the end of the leg from the stop, not from the line carried on', async () => {
    const leg = await legOver(() => -2500, mapOf({ points: [{ kind: 'small crater', at: at(2.5), map: MAP }] }))
    expect(hazardsOf(leg)).toEqual([])
  })

  it('flags ridged ground once where the leg enters it, however many edges it crosses', async () => {
    const area = { kind: 'ridged', rings: [box(0.5, 1.5, -1, 1)], map: MAP }
    const hazards = hazardsOf(await legOver(() => -2500, mapOf({ areas: [area] })))
    expect(hazards).toHaveLength(1)
    expect(hazards[0].unit).toBe('ridged')
    expect(xOf(hazards[0].coordinate)).toBeCloseTo(0.5, 3)
  })

  it('flags a leg wholly inside ridged ground, at its start, though it crosses no edge', async () => {
    const area = { kind: 'ridged', rings: [box(-1, 3, -1, 1)], map: MAP }
    const [h] = hazardsOf(await legOver(() => -2500, mapOf({ areas: [area] })))
    expect(h.unit).toBe('ridged')
    expect(xOf(h.coordinate)).toBeCloseTo(0, 6)
  })

  it('does not flag a leg wholly in a hole of ridged ground, or mantling material', async () => {
    const holed = { kind: 'ridged', rings: [box(-2, 4, -2, 2), box(-1, 3, -1, 1)], map: MAP }
    const mantle = { kind: 'dark-colored mantling material', rings: [box(0.5, 1.5, -1, 1)], map: MAP }
    expect(hazardsOf(await legOver(() => -2500, mapOf({ areas: [holed, mantle] })))).toEqual([])
  })

  it('does not flag ridged ground beside the leg', async () => {
    const area = { kind: 'ridged', rings: [box(0.5, 1.5, 0.2, 1)], map: MAP }
    expect(hazardsOf(await legOver(() => -2500, mapOf({ areas: [area] })))).toEqual([])
  })

  it('walks a line, a crater and ridged ground in order along the leg, each with its own id', async () => {
    const leg = await legOver(
      () => -2500,
      mapOf({
        lines: [ridge(1.5, -1, 1)],
        points: [{ kind: 'small crater', at: at(0.3, 0.05), map: MAP }],
        areas: [{ kind: 'ridged', rings: [box(0.8, 1.2, -1, 1)], map: MAP }],
      }),
    )
    expect(hazardsOf(leg).map((h) => [h.id, h.unit])).toEqual([
      ['a-b-obstacle-1', 'small crater'],
      ['a-b-obstacle-2', 'ridged'],
      ['a-b-obstacle-3', RIDGE_CREST],
    ])
  })

  it('orders several crossings along the leg, after the slope hazards', async () => {
    const leg = await oneLeg(ramp(25), [ridge(1.5, -1, 1, 'crest of crater rim'), ridge(0.4, -1, 1)])
    const kinds = hazardsOf(leg).map((h) => [h.kind, h.unit])
    expect(kinds).toEqual([
      ['slope', '°'],
      ['mapped-obstacle', RIDGE_CREST],
      ['mapped-obstacle', 'crest of crater rim'],
    ])
    expect(new Set(hazardsOf(leg).map((h) => h.id)).size).toBe(3)
  })

  it('gives one leg per pair of stops, in order, from one read of the heights', async () => {
    const { heights, calls } = dem(() => -2500)
    const stops = [stop('a', 0), stop('b', 1), stop('c', 1, 1)]
    const legs = await walkLegs(stops, heights, CELL, NO_FEATURES, SUITED_SLOPE_LIMIT, live())
    expect(legs.map((l) => [l.fromStopId, l.toStopId])).toEqual([
      ['a', 'b'],
      ['b', 'c'],
    ])
    expect(calls).toHaveLength(1)
    const path = legs[1].path.classification === 'DERIVED' ? legs[1].path.value : []
    expect(path[0].longitudeEast).toBeCloseTo(stops[1].coordinate.longitudeEast, 10)
    expect(path.at(-1)?.latitude).toBeCloseTo(stops[2].coordinate.latitude, 10)
  })

  it('samples no finer than the elevation model\'s cells', async () => {
    const coarse = dem(() => -2500)
    await walkLegs([stop('a', 0), stop('b', 2)], coarse.heights, CELL, NO_FEATURES, SUITED_SLOPE_LIMIT, live())
    expect(coarse.calls[0]).toBe(10) // 2 km on 200 m cells: never two samples to a cell
    const fine = dem(() => -2500)
    await walkLegs([stop('a', 0), stop('b', 2)], fine.heights, () => 0.001, NO_FEATURES, SUITED_SLOPE_LIMIT, live())
    expect(fine.calls[0]).toBe(200) // capped, as the profile chart is
  })

  it('makes a leg between two stops at one place UNAVAILABLE, not 0 km', async () => {
    const [leg] = await walkLegs([stop('a', 1), stop('b', 1)], dem(() => 0).heights, CELL, NO_FEATURES, SUITED_SLOPE_LIMIT, live())
    expect(leg.path.classification).toBe('UNAVAILABLE')
    expect(leg.distanceKm.classification).toBe('UNAVAILABLE')
    expect(leg.hazards.classification).toBe('UNAVAILABLE')
  })

  it('returns no legs for a single stop', async () => {
    expect(await walkLegs([stop('a', 0)], dem(() => 0).heights, CELL, NO_FEATURES, SUITED_SLOPE_LIMIT, live())).toEqual([])
  })

  it('stops when cancelled, before or during the read', async () => {
    const before = new AbortController()
    before.abort()
    await expect(
      walkLegs([stop('a', 0), stop('b', 2)], dem(() => 0).heights, CELL, NO_FEATURES, SUITED_SLOPE_LIMIT, before.signal),
    ).rejects.toThrow('Cancelled')

    const during = new AbortController()
    const slow: WalkHeights = (points) => {
      during.abort()
      const n = points.length / 2
      const models = [{ cellKm: 0.2, source: 'fixture', site: false }]
      return Promise.resolve(official({ heights: new Float32Array(n), model: new Uint8Array(n), models }, 'fixture'))
    }
    await expect(
      walkLegs([stop('a', 0), stop('b', 2)], slow, CELL, NO_FEATURES, SUITED_SLOPE_LIMIT, during.signal),
    ).rejects.toThrow('Cancelled')
  })

  it('refuses a read of the wrong length rather than misaligning it', async () => {
    const models = [{ cellKm: 0.2, source: 'fixture', site: false }]
    const short: WalkHeights = () =>
      Promise.resolve(official({ heights: new Float32Array(3), model: new Uint8Array(3), models }, 'fixture'))
    await expect(
      walkLegs([stop('a', 0), stop('b', 2)], short, CELL, NO_FEATURES, SUITED_SLOPE_LIMIT, live()),
    ).rejects.toThrow(/3 heights for 10 samples/)
  })
})

describe('segmentCrossing', () => {
  const o = { x: 0, y: 0 }
  it('finds where two segments cross, and how far along the first', () => {
    expect(segmentCrossing(o, { x: 2, y: 0 }, { x: 0.5, y: -1 }, { x: 0.5, y: 1 })).toEqual({ x: 0.5, y: 0, t: 0.25 })
  })
  it('counts touching at an end, and not parallel or separate segments', () => {
    expect(segmentCrossing(o, { x: 1, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 })?.t).toBe(1)
    expect(segmentCrossing(o, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 })).toBeNull()
    expect(segmentCrossing(o, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull()
    expect(segmentCrossing(o, { x: 1, y: 0 }, { x: 2, y: -1 }, { x: 2, y: 1 })).toBeNull()
  })
})
