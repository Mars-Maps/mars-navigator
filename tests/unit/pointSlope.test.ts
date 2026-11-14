import { describe, expect, it } from 'vitest'
import { MARS_MEAN_RADIUS_KM, type MarsCoordinate } from '../../src/domain'
import {
  hornSlopeDegrees,
  initialSpacingKm,
  SLOPE_SPACING_CELLS,
  slopeAtPoint,
  slopeSamplePoints,
  type SlopeModel,
  type SlopeRead,
} from '../../src/features/route-analysis/pointSlope'
import { surfaceDistanceKm } from '../../src/features/route-analysis/routeDistance'

// Test fixtures only: invented grids and models, never shown in the app.
const FINE: SlopeModel = { cellKm: 0.02, source: 'fixture fine model', site: true }
const GLOBAL: SlopeModel = { cellKm: 0.2, source: 'fixture global model', site: false }
const FINEST: SlopeModel = { cellKm: 0.001, source: 'fixture finest site model', site: true }
const MODELS = [FINE, GLOBAL, FINEST]
const NO_DATA = 'fixture: no model has data here'

/** Heights of a plane on the 3×3 grid: `east` and `north` metres of rise per metre, rows north to south. */
function plane(east: number, north: number, spacingM: number, base = -2500): number[] {
  const z: number[] = []
  for (const row of [1, 0, -1]) for (const col of [-1, 0, 1]) z.push(base + (col * east + row * north) * spacingM)
  return z
}
const read = (heights: number[], model: number | number[] = 1): SlopeRead => ({
  heights,
  model: Array.isArray(model) ? model : Array(9).fill(model),
  models: MODELS,
})
const deg = (rad: number) => (rad * 180) / Math.PI

describe('hornSlopeDegrees', () => {
  it('gives 0° on flat ground', () => {
    expect(hornSlopeDegrees(Array(9).fill(-2500), 400)).toBe(0)
  })

  it('gives the plane\'s slope whichever way it faces', () => {
    expect(hornSlopeDegrees(plane(0.1, 0, 400), 400)).toBeCloseTo(deg(Math.atan(0.1)), 10)
    expect(hornSlopeDegrees(plane(0, -0.1, 400), 400)).toBeCloseTo(deg(Math.atan(0.1)), 10)
    // 0.3 east and 0.4 north: the steepest direction rises 0.5 per metre.
    expect(hornSlopeDegrees(plane(0.3, 0.4, 400), 400)).toBeCloseTo(deg(Math.atan(0.5)), 10)
  })

  it('reads a 45° plane as 45°', () => {
    expect(hornSlopeDegrees(plane(1, 0, 40), 40)).toBeCloseTo(45, 10)
  })
})

describe('slopeAtPoint', () => {
  const spacing = initialSpacingKm(GLOBAL.cellKm)

  it('returns a DERIVED slope stating its method, spacing and source', () => {
    const a = slopeAtPoint(read(plane(0.1, 0, spacing * 1000)), spacing, NO_DATA)
    expect(a.kind).toBe('slope')
    if (a.kind !== 'slope') return
    expect(a.slope.classification).toBe('DERIVED')
    if (a.slope.classification !== 'DERIVED') return
    expect(a.slope.value).toBeCloseTo(5.711, 3)
    expect(a.slope.method).toMatch(/Horn/)
    expect(a.slope.method).toContain('400 m apart')
    expect(a.slope.method).toContain('about 800 m of ground')
    expect(a.slope.method).toContain('fixture global model')
    expect(a.slope.method).toMatch(/can be steeper/)
  })

  it('returns 0°, as DERIVED, on flat ground', () => {
    const a = slopeAtPoint(read(Array(9).fill(-2500)), spacing, NO_DATA)
    expect(a.kind === 'slope' && a.slope.classification === 'DERIVED' && a.slope.value).toBe(0)
  })

  it('gives the chain\'s reason when the point itself has no height', () => {
    const z = plane(0.1, 0, 400)
    z[4] = Number.NaN
    expect(slopeAtPoint(read(z), spacing, NO_DATA)).toEqual({
      kind: 'slope',
      slope: { classification: 'UNAVAILABLE', reason: NO_DATA },
    })
  })

  it('is UNAVAILABLE, never 0, when a height around the point is missing', () => {
    for (const k of [0, 1, 3, 5, 8]) {
      const z = Array(9).fill(-2500)
      z[k] = Number.NaN
      const a = slopeAtPoint(read(z), spacing, NO_DATA)
      expect(a.kind === 'slope' && a.slope.classification).toBe('UNAVAILABLE')
      expect(a.kind === 'slope' && a.slope.classification === 'UNAVAILABLE' && a.slope.reason).toMatch(/no height/)
    }
  })

  it('asks to read again wider when the heights came from a coarser model than the spacing', () => {
    // Spaced for the fine model, but the fine model had a gap: the global one answered.
    const fineSpacing = initialSpacingKm(FINE.cellKm)
    expect(slopeAtPoint(read(Array(9).fill(-2500), 1), fineSpacing, NO_DATA)).toEqual({
      kind: 'read-again',
      spacingKm: GLOBAL.cellKm * SLOPE_SPACING_CELLS,
    })
    // One coarse sample is enough to need the wider spacing.
    const mixed = [0, 0, 0, 0, 0, 0, 0, 0, 1]
    expect(slopeAtPoint(read(Array(9).fill(-2500), mixed), fineSpacing, NO_DATA).kind).toBe('read-again')
  })

  it('is UNAVAILABLE when the grid mixes a site model with the global one at a spacing wide enough for both', () => {
    const mixed = [0, 0, 0, 0, 0, 0, 0, 0, 1]
    const a = slopeAtPoint(read(plane(0.1, 0, spacing * 1000), mixed), spacing, NO_DATA)
    expect(a.kind === 'slope' && a.slope.classification).toBe('UNAVAILABLE')
    expect(a.kind === 'slope' && a.slope.classification === 'UNAVAILABLE' && a.slope.reason).toMatch(/site model and the global one/)
  })

  it('mixes the site\'s own models in one kernel, at the coarser one\'s spacing, naming both', () => {
    // Spaced for the 20 m model; two samples came from the 1 m model beside it.
    const fineSpacing = initialSpacingKm(FINE.cellKm)
    const mixed = [2, 0, 0, 2, 0, 0, 0, 0, 0]
    const a = slopeAtPoint(read(plane(0.1, 0, fineSpacing * 1000), mixed), fineSpacing, NO_DATA)
    expect(a.kind).toBe('slope')
    if (a.kind !== 'slope' || a.slope.classification !== 'DERIVED') throw new Error('expected a DERIVED slope')
    expect(a.slope.value).toBeCloseTo(5.711, 3)
    expect(a.slope.method).toContain('40 m apart')
    expect(a.slope.method).toContain('cells of the coarsest model used')
    expect(a.slope.method).toContain('2 models of the site')
    expect(a.slope.method).toContain('1 m cells: fixture finest site model')
    expect(a.slope.method).toContain('20 m cells: fixture fine model')
    expect(a.slope.method).not.toContain('fixture global model')
    // Still read again if the spacing was the finer model's.
    const finestSpacing = initialSpacingKm(FINEST.cellKm)
    expect(slopeAtPoint(read(Array(9).fill(-2500), mixed), finestSpacing, NO_DATA)).toEqual({
      kind: 'read-again',
      spacingKm: fineSpacing,
    })
  })

  it('names one model only, without the mixing note, when every height came from it', () => {
    const a = slopeAtPoint(read(Array(9).fill(-2500)), spacing, NO_DATA)
    if (a.kind !== 'slope' || a.slope.classification !== 'DERIVED') throw new Error('expected a DERIVED slope')
    expect(a.slope.method).toContain('cells of the model)')
    expect(a.slope.method).toContain('Heights: fixture global model')
    expect(a.slope.method).not.toContain('models of the site')
  })

  it('uses the fine model\'s spacing when every height came from it', () => {
    const fineSpacing = initialSpacingKm(FINE.cellKm)
    const a = slopeAtPoint(read(plane(0.2, 0, fineSpacing * 1000), 0), fineSpacing, NO_DATA)
    expect(a.kind === 'slope' && a.slope.classification === 'DERIVED' && a.slope.method).toContain('40 m apart')
  })

  it('is UNAVAILABLE for a model it does not know, or a grid of the wrong size', () => {
    const unknown = slopeAtPoint(read(Array(9).fill(0), 7), spacing, NO_DATA)
    expect(unknown.kind === 'slope' && unknown.slope.classification).toBe('UNAVAILABLE')
    const short = slopeAtPoint({ heights: [0, 0, 0], model: [1, 1, 1], models: MODELS }, spacing, NO_DATA)
    expect(short.kind === 'slope' && short.slope.classification).toBe('UNAVAILABLE')
  })
})

describe('slopeSamplePoints', () => {
  const JEZERO: MarsCoordinate = { latitude: 18.44, longitudeEast: 77.45 }
  const pairs = (p: Float64Array) =>
    Array.from({ length: 9 }, (_, k) => ({ latitude: p[k * 2], longitudeEast: p[k * 2 + 1] }))

  it('lays out nine points north to south, west to east, the centre fifth', () => {
    const p = pairs(slopeSamplePoints(JEZERO, 0.4)!)
    expect(p[4]).toEqual(JEZERO)
    expect(p[1].latitude).toBeGreaterThan(JEZERO.latitude)
    expect(p[7].latitude).toBeLessThan(JEZERO.latitude)
    expect(p[3].longitudeEast).toBeLessThan(JEZERO.longitudeEast)
    expect(p[5].longitudeEast).toBeGreaterThan(JEZERO.longitudeEast)
  })

  it('spaces them the asked distance apart on the ground, east–west too', () => {
    const p = pairs(slopeSamplePoints(JEZERO, 0.4)!)
    for (const k of [1, 3, 5, 7]) expect(surfaceDistanceKm(JEZERO, p[k])).toBeCloseTo(0.4, 4)
    expect((p[1].latitude - JEZERO.latitude) * ((MARS_MEAN_RADIUS_KM * Math.PI) / 180)).toBeCloseTo(0.4, 10)
  })

  it('wraps longitudes across 0/360°E', () => {
    const p = pairs(slopeSamplePoints({ latitude: 0, longitudeEast: 0 }, 0.4)!)
    expect(p[3].longitudeEast).toBeGreaterThan(359.9)
    expect(p[3].longitudeEast).toBeLessThan(360)
    expect(p[5].longitudeEast).toBeLessThan(0.1)
  })

  it('refuses a point near a pole, an invalid point or no spacing', () => {
    expect(slopeSamplePoints({ latitude: 86, longitudeEast: 10 }, 0.4)).toBeNull()
    expect(slopeSamplePoints({ latitude: Number.NaN, longitudeEast: 10 }, 0.4)).toBeNull()
    expect(slopeSamplePoints(JEZERO, 0)).toBeNull()
  })
})
