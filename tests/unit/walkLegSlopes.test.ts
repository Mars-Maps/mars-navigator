import { describe, expect, it } from 'vitest'
import {
  MARS_MEAN_RADIUS_KM,
  SUITED_SLOPE_LIMIT,
  derived,
  official,
  unavailable,
  type Hazard,
  type MarsCoordinate,
  type WalkLeg,
  type WalkStop,
} from '../../src/domain'
import type { SlopeModel } from '../../src/features/route-analysis/pointSlope'
import { walkLegs, type WalkHeights } from '../../src/features/route-analysis/walkLegs'

/**
 * The slope check against heights as the real chain answers them: the
 * nearest cell's, each from the model that has data there.
 * Test fixtures only: invented planes and models near Jezero.
 */
const START: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
const RAD = Math.PI / 180
const KM_PER_DEG_LAT = MARS_MEAN_RADIUS_KM * RAD
const KM_PER_DEG_LON = KM_PER_DEG_LAT * Math.cos(START.latitude * RAD)

const at = (x: number, y = 0): MarsCoordinate => ({
  latitude: START.latitude + y / KM_PER_DEG_LAT,
  longitudeEast: START.longitudeEast + x / KM_PER_DEG_LON,
})
const stop = (id: string, x: number, y = 0): WalkStop => ({
  id,
  label: id,
  coordinate: at(x, y),
  unit: unavailable('fixture'),
  reason: derived('fixture', 'fixture'),
})

const HIRISE: SlopeModel = { cellKm: 0.001, source: 'fixture HiRISE', site: true }
const CTX: SlopeModel = { cellKm: 0.02, source: 'fixture CTX', site: true }
const GLOBAL: SlopeModel = { cellKm: 0.2, source: 'fixture global', site: false }
const MODELS = [HIRISE, CTX, GLOBAL]

/** Which model answers at a place, and its height there before snapping to a cell. */
type Answer = (x: number, y: number) => { model: SlopeModel; z: number }

/** A chain answering as the real one does: each height is the centre of the answering model's nearest cell. */
function chain(answer: Answer): WalkHeights {
  return (points) => {
    const n = points.length / 2
    const heights = new Float32Array(n)
    const model = new Uint8Array(n)
    for (let i = 0; i < n; i++) {
      const x = (points[i * 2 + 1] - START.longitudeEast) * KM_PER_DEG_LON
      const y = (points[i * 2] - START.latitude) * KM_PER_DEG_LAT
      const m = answer(x, y).model
      const c = m.cellKm
      heights[i] = answer(Math.round(x / c) * c, Math.round(y / c) * c).z
      model[i] = MODELS.indexOf(m)
    }
    return Promise.resolve(official({ heights, model, models: MODELS }, 'fixture chain'))
  }
}

/** A uniform plane rising `deg` along the direction (dx, dy), read through one model. */
const plane =
  (deg: number, model: SlopeModel, dx = 1, dy = 0): Answer =>
  (x, y) => ({
    model,
    z: (((x * dx + y * dy) / Math.hypot(dx, dy)) * 1000 * Math.tan(deg * RAD)) - 2500,
  })

const live = () => new AbortController().signal

async function walk(answer: Answer, toX: number, toY = 0, askedCellKm = 0.2, fromX = 0, fromY = 0): Promise<WalkLeg> {
  const [leg] = await walkLegs(
    [stop('a', fromX, fromY), stop('b', toX, toY)],
    chain(answer),
    () => askedCellKm,
    official({ points: [], lines: [], areas: [] }, 'fixture map'),
    SUITED_SLOPE_LIMIT,
    live(),
  )
  return leg
}
/** The leg's slope hazards: these planes climb far enough to earn a radiation warning too, tested on its own. */
const hazardsOf = (leg: WalkLeg): Hazard[] =>
  leg.hazards.classification === 'DERIVED' ? leg.hazards.value.filter((h) => h.kind === 'slope') : []
const steepest = (leg: WalkLeg) => (leg.steepestSlopeDeg.classification === 'DERIVED' ? leg.steepestSlopeDeg.value : null)
const reasonOf = (h: Hazard) => (h.magnitude.classification === 'UNAVAILABLE' ? h.magnitude.reason : '')

describe('walkLegs on nearest-cell heights', () => {
  // Cases that each once flagged a plane under the limit.
  it.each([
    ['12°, 200 m cells, 2 km', 12, GLOBAL, 2, 0],
    ['12°, 20 m cells, 3 km', 12, CTX, 3, 0],
    ['14°, 20 m cells, 5 km', 14, CTX, 5, 0],
    ['15°, 20 m cells, 5 km', 15, CTX, 5, 0],
    ['15°, 200 m cells, 5 km', 15, GLOBAL, 5, 0],
    ['15°, 200 m cells, 5 km diagonal', 15, GLOBAL, 3.5, 3.5],
    ['15°, 20 m cells, 3 km diagonal', 15, CTX, 2, 2],
  ])('does not flag a uniform plane under the limit: %s', async (_name, deg, model, toX, toY) => {
    const leg = await walk(plane(deg, model, toX, toY), toX, toY, model.cellKm)
    expect(hazardsOf(leg)).toEqual([])
    const figure = steepest(leg)
    expect(figure).not.toBeNull()
    expect(figure as number).toBeGreaterThan(deg * 0.8)
    expect(figure as number).toBeLessThan(20)
  })

  it('still flags a uniform plane over the limit', async () => {
    const leg = await walk(plane(25, CTX), 3, 0, CTX.cellKm)
    const hazards = hazardsOf(leg)
    expect(hazards).toHaveLength(1)
    expect(hazards[0].magnitude.classification).toBe('DERIVED')
    expect(steepest(leg) as number).toBeGreaterThan(20)
  })

  it('keeps the baseline to the model that answers, not the one the leg was sampled for', async () => {
    // Inside a 1 m model's grid, with the 20 m model answering: samples 2.7 m apart read one cell many times.
    const leg = await walk(plane(12, CTX), 0.54, 0, 0.0027)
    expect(hazardsOf(leg)).toEqual([])
    expect(steepest(leg) as number).toBeLessThan(16)
    expect(leg.steepestSlopeDeg.classification === 'DERIVED' && leg.steepestSlopeDeg.method).toMatch(
      /over about 10\d m of ground, at least 5 cells/,
    )
    expect(leg.steepestSlopeDeg.classification === 'DERIVED' && leg.steepestSlopeDeg.method).toContain('fixture CTX')
  })

  it('does not read a step between a site model and the global one as a slope', async () => {
    // Flat on both sides, 67.5 m apart, as measured at the CTX north edge.
    const edge: Answer = (x) => (x < 2 ? { model: CTX, z: -2500 } : { model: GLOBAL, z: -2432.5 })
    const leg = await walk(edge, 5, 0, CTX.cellKm)
    const hazards = hazardsOf(leg)
    expect(hazards).toHaveLength(1)
    expect(hazards[0].magnitude.classification).toBe('UNAVAILABLE')
    expect(reasonOf(hazards[0])).toMatch(/not checked against 20°/)
    expect(reasonOf(hazards[0])).toContain('that step would read as a slope')
    // Nothing measured steep, and the leg does not claim a steepest figure with ground unchecked.
    expect(leg.steepestSlopeDeg.classification).toBe('UNAVAILABLE')
    expect(leg.steepestSlopeDeg.classification === 'UNAVAILABLE' && leg.steepestSlopeDeg.reason).toMatch(
      /steepest measured stretch is 0\.0°/,
    )
  })

  it('does not check a short patch of the global model inside a gap in a site model', async () => {
    const holed: Answer = (x) =>
      x > 1 && x < 1.3 ? { model: GLOBAL, z: -2450 } : { model: CTX, z: -2500 }
    const hazards = hazardsOf(await walk(holed, 3, 0, CTX.cellKm))
    expect(hazards).toHaveLength(1)
    expect(hazards[0].magnitude.classification).toBe('UNAVAILABLE')
    expect(reasonOf(hazards[0])).toContain('that step would read as a slope')
    expect(reasonOf(hazards[0])).toContain('too close to a gap')
  })

  it('lets the site\'s own models share a measurement, so a small step between them is not a flag', async () => {
    // A 4.7 m step between the 1 m and 20 m models, as measured, on flat ground.
    const seam: Answer = (x) => (x < 1 ? { model: HIRISE, z: -2500 } : { model: CTX, z: -2495.3 })
    const leg = await walk(seam, 2, 0, CTX.cellKm)
    expect(hazardsOf(leg)).toEqual([])
    expect(leg.steepestSlopeDeg.classification).toBe('DERIVED')
    expect(steepest(leg) as number).toBeLessThan(3)
    const method = leg.steepestSlopeDeg.classification === 'DERIVED' ? leg.steepestSlopeDeg.method : ''
    expect(method).toContain('fixture HiRISE | fixture CTX')
  })

  it('says a leg shorter than the baseline was not checked, and gives no figure', async () => {
    const leg = await walk(plane(30, GLOBAL), 0.5)
    const hazards = hazardsOf(leg)
    expect(hazards).toHaveLength(1)
    expect(hazards[0].magnitude.classification).toBe('UNAVAILABLE')
    expect(reasonOf(hazards[0])).toContain('the end of the leg to measure over 5 cells')
    expect(leg.steepestSlopeDeg.classification).toBe('UNAVAILABLE')
  })

  it('keeps each leg to its own heights and models when one read serves several', async () => {
    const answer: Answer = (x) => (x < 3 ? { model: CTX, z: -2500 } : { model: GLOBAL, z: -2500 + (x - 3) * 1000 * Math.tan(30 * RAD) })
    const legs = await walkLegs(
      [stop('a', 0), stop('b', 2.5), stop('c', 3.1), stop('d', 8)],
      chain(answer),
      () => CTX.cellKm,
      official({ points: [], lines: [], areas: [] }, 'fixture map'),
      SUITED_SLOPE_LIMIT,
      live(),
    )
    expect(hazardsOf(legs[0])).toEqual([])
    expect(legs[0].steepestSlopeDeg.classification === 'DERIVED' && legs[0].steepestSlopeDeg.method).not.toContain('fixture global')
    expect(hazardsOf(legs[2])[0].magnitude.classification).toBe('DERIVED')
    expect(legs[2].steepestSlopeDeg.classification === 'DERIVED' && legs[2].steepestSlopeDeg.method).not.toContain('fixture CTX')
  })

  it('refuses a height from a model it was not told about', async () => {
    const stray: WalkHeights = (points) => {
      const n = points.length / 2
      const read = { heights: new Float32Array(n), model: new Uint8Array(n).fill(9), models: MODELS }
      return Promise.resolve(official(read, 'fixture'))
    }
    await expect(
      walkLegs(
        [stop('a', 0), stop('b', 2)],
        stray,
        () => 0.2,
        official({ points: [], lines: [], areas: [] }, 'fixture map'),
        SUITED_SLOPE_LIMIT,
        live(),
      ),
    ).rejects.toThrow(/does not know/)
  })
})
