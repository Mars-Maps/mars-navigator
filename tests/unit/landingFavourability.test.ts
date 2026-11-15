import { describe, expect, it } from 'vitest'
import {
  FLAT_MAX_DEG,
  LANDING_LEGEND,
  LANDING_RATING,
  LANDING_REASON,
  LANDING_REASON_TEXT,
  STEEP_MIN_DEG,
  landingFavourability,
  rateCell,
  type LandingGrid,
} from '../../src/features/route-analysis/landingFavourability'
import { hornSlopeDegrees, type SlopeModel } from '../../src/features/route-analysis/pointSlope'

// Test fixtures only: invented grids and models, never shown in the app.
const SITE: SlopeModel = { cellKm: 0.02, source: 'fixture site model', site: true }
const SITE_2: SlopeModel = { cellKm: 0.005, source: 'fixture second site model', site: true }
const GLOBAL: SlopeModel = { cellKm: 0.2, source: 'fixture global model', site: false }
const MODELS = [SITE, SITE_2, GLOBAL]
const SPACING_KM = 0.05 // 2.5 cells of the site model

/** A tilted plane: `rise` metres per metre eastward, `cols × rows` cells. */
function grid(cols: number, rows: number, rise: number, inside: number | ((k: number) => number) = 1): LandingGrid {
  const n = cols * rows
  const heights = new Float64Array(n)
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) heights[r * cols + c] = -2500 + c * rise * SPACING_KM * 1000
  return {
    cols,
    rows,
    spacingEastKm: SPACING_KM,
    spacingNorthKm: SPACING_KM,
    heights,
    model: new Uint8Array(n),
    models: MODELS,
    insideCrater: Uint8Array.from({ length: n }, (_, k) => (typeof inside === 'function' ? inside(k) : inside)),
  }
}
const riseFor = (deg: number) => Math.tan((deg * Math.PI) / 180)
const centre = (cols: number, rows: number) => Math.floor(rows / 2) * cols + Math.floor(cols / 2)
function rate(g: LandingGrid) {
  const out = landingFavourability(g)
  if (!out.ok) throw new Error(out.reason)
  return out
}

describe('rateCell', () => {
  it('rates flat ground inside the crater green', () => {
    expect(rateCell(0, true)).toBe('green')
    expect(rateCell(FLAT_MAX_DEG, true)).toBe('green')
  })
  it('never rates flat ground outside the crater green', () => {
    expect(rateCell(0, false)).toBe('yellow')
  })
  it('rates a moderate slope yellow inside or out', () => {
    expect(rateCell(FLAT_MAX_DEG + 1, true)).toBe('yellow')
    expect(rateCell(STEEP_MIN_DEG - 0.1, false)).toBe('yellow')
  })
  it('rates steep ground red anywhere', () => {
    expect(rateCell(STEEP_MIN_DEG, true)).toBe('red')
    expect(rateCell(40, false)).toBe('red')
  })
  it('gives no colour without a slope', () => {
    expect(rateCell(Number.NaN, true)).toBe('unavailable')
  })
})

describe('landingFavourability', () => {
  it('rates flat ground inside the crater green', () => {
    const out = rate(grid(5, 5, 0, 1))
    const k = centre(5, 5)
    expect(out.rating[k]).toBe(LANDING_RATING.green)
    expect(out.slopeDeg[k]).toBe(0)
    expect(out.reason[k]).toBe(LANDING_REASON.none)
  })

  it('rates flat ground outside the crater yellow, never green', () => {
    const out = rate(grid(5, 5, 0, 0))
    for (let k = 0; k < 25; k++) expect(out.rating[k]).not.toBe(LANDING_RATING.green)
    expect(out.rating[centre(5, 5)]).toBe(LANDING_RATING.yellow)
  })

  it('rates steep ground red inside and outside the crater', () => {
    for (const inside of [0, 1]) {
      const out = rate(grid(5, 5, riseFor(25), inside))
      const k = centre(5, 5)
      expect(out.rating[k]).toBe(LANDING_RATING.red)
      expect(out.slopeDeg[k]).toBeCloseTo(25, 4)
    }
  })

  it('rates a moderate slope yellow inside the crater', () => {
    const out = rate(grid(5, 5, riseFor(10), 1))
    expect(out.rating[centre(5, 5)]).toBe(LANDING_RATING.yellow)
  })

  it('matches hornSlopeDegrees on the same nine heights', () => {
    const g = grid(3, 3, 0)
    const z = [1, 4, 2, 0, 3, 7, 5, 2, 9]
    g.heights = Float64Array.from(z)
    expect(rate(g).slopeDeg[4]).toBeCloseTo(hornSlopeDegrees(z, SPACING_KM * 1000), 4)
  })

  it('leaves a cell with no height unavailable, never a colour, and its neighbours too', () => {
    const g = grid(5, 5, 0, 1)
    const k = centre(5, 5)
    ;(g.heights as Float64Array)[k] = Number.NaN
    const out = rate(g)
    expect(out.rating[k]).toBe(LANDING_RATING.unavailable)
    expect(out.reason[k]).toBe(LANDING_REASON.noHeight)
    expect(Number.isNaN(out.slopeDeg[k])).toBe(true)
    expect(out.rating[k - 1]).toBe(LANDING_RATING.unavailable)
    expect(out.reason[k - 1]).toBe(LANDING_REASON.noHeight)
  })

  it('does not read a seam between a site model and the global one as a slope', () => {
    // Flat ground with the global model 40 m lower on the east half: a step, not a slope.
    const g = grid(6, 5, 0, 1)
    const heights = g.heights as Float64Array
    const model = g.model as Uint8Array
    for (let r = 0; r < 5; r++) for (let c = 3; c < 6; c++) {
      heights[r * 6 + c] -= 40
      model[r * 6 + c] = 2
    }
    g.spacingEastKm = g.spacingNorthKm = 0.4 // two global cells, so only the seam stops it
    const out = rate(g)
    for (const k of [2 * 6 + 2, 2 * 6 + 3]) {
      expect(out.rating[k]).toBe(LANDING_RATING.unavailable)
      expect(out.reason[k]).toBe(LANDING_REASON.seam)
    }
    // Away from the seam each side is rated on its own model.
    expect(out.rating[2 * 6 + 1]).toBe(LANDING_RATING.green)
    expect(out.rating[2 * 6 + 4]).toBe(LANDING_RATING.green)
  })

  it('lets two site models meet in one window', () => {
    const g = grid(5, 5, 0, 1)
    ;(g.model as Uint8Array).fill(1, 0, 10)
    expect(rate(g).rating[centre(5, 5)]).toBe(LANDING_RATING.green)
  })

  it('refuses a lattice finer than two cells of the model, so one cell does not read as flat', () => {
    const g = grid(5, 5, 0, 1)
    ;(g.model as Uint8Array).fill(2) // the global model's 200 m cells, a 50 m lattice
    const out = rate(g)
    expect(out.rating[centre(5, 5)]).toBe(LANDING_RATING.unavailable)
    expect(out.reason[centre(5, 5)]).toBe(LANDING_REASON.tooFine)
  })

  it('leaves the grid edge unavailable', () => {
    const out = rate(grid(4, 4, 0, 1))
    for (const k of [0, 1, 2, 3, 4, 7, 8, 11, 12, 13, 14, 15]) expect(out.reason[k]).toBe(LANDING_REASON.edge)
    for (const k of [5, 6, 9, 10]) expect(out.rating[k]).toBe(LANDING_RATING.green)
  })

  it('refuses a grid whose arrays do not match its size', () => {
    const g = grid(4, 4, 0)
    g.heights = new Float64Array(15)
    expect(landingFavourability(g).ok).toBe(false)
    expect(landingFavourability({ ...grid(4, 4, 0), spacingEastKm: 0 }).ok).toBe(false)
  })

  it('states its method, the thresholds as project choices, and every reason in words', () => {
    const out = rate(grid(4, 4, 0))
    expect(out.method).toContain('Horn')
    expect(out.method).toContain('project choices')
    expect(out.method).toContain('fixture site model')
    expect(LANDING_LEGEND.note).toContain('not a statement that a landing is safe')
    expect(LANDING_LEGEND.note).toContain('project choices')
    for (const code of Object.values(LANDING_REASON)) if (code !== 0) expect(LANDING_REASON_TEXT[code]).toBeTruthy()
  })

  // A guard against the loop growing a hidden cost, not a promise about a
  // full sheet: wall-clock on a shared machine, so a small grid, warmed up,
  // the best of several, and a bound many times what it takes. A 1024 × 1024
  // lattice takes a few hundred ms on a busy machine and belongs off the
  // main thread (see `landingFavourability`).
  it('rates a 256 × 256 grid well inside a frame budget of 200 ms', () => {
    const side = 256
    const g = grid(side, side, 0, (k) => (k % 2))
    const h = g.heights as Float64Array
    for (let k = 0; k < h.length; k++) h[k] += Math.sin(k * 0.01) * 3
    rate(g)
    let best = Number.POSITIVE_INFINITY
    for (let run = 0; run < 5; run++) {
      const t0 = performance.now()
      rate(g)
      best = Math.min(best, performance.now() - t0)
    }
    expect(best).toBeLessThan(200)
  })

  it('never rates green where the crater flag is not a number', () => {
    const g = { ...grid(5, 5, 0), insideCrater: new Float32Array(25).fill(Number.NaN) }
    const out = rate(g)
    expect(out.rating[centre(5, 5)]).toBe(LANDING_RATING.yellow)
    expect([...out.rating]).not.toContain(LANDING_RATING.green)
  })

  it('uses the north spacing for a northward tilt and the east spacing for an eastward one', () => {
    // 10° northward on a lattice 50 m east–west by 100 m north–south: read with the spacings swapped it would be about 19.4°.
    const cols = 5, rows = 5, northKm = 0.1
    const northward: LandingGrid = { ...grid(cols, rows, 0), spacingNorthKm: northKm }
    const hN = northward.heights as Float64Array
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) hN[r * cols + c] = -2500 + (rows - 1 - r) * riseFor(10) * northKm * 1000
    expect(rate(northward).slopeDeg[centre(cols, rows)]).toBeCloseTo(10, 3)
    // 10° eastward on the same lattice: the east spacing is the one that counts.
    const eastward: LandingGrid = { ...grid(cols, rows, riseFor(10)), spacingNorthKm: northKm }
    expect(rate(eastward).slopeDeg[centre(cols, rows)]).toBeCloseTo(10, 3)
  })

  it('names the seam, not the too-fine lattice, beside a site model', () => {
    // 50 m lattice: fine for the 20 m site model, too fine for the 200 m global one. West half site, east half global.
    const g = grid(6, 5, 0)
    const model = g.model as Uint8Array
    for (let r = 0; r < 5; r++) for (let c = 3; c < 6; c++) model[r * 6 + c] = 2
    const out = rate(g)
    expect(out.reason[2 * 6 + 2]).toBe(LANDING_REASON.seam)
    expect(out.reason[2 * 6 + 3]).toBe(LANDING_REASON.seam)
    expect(out.reason[2 * 6 + 4]).toBe(LANDING_REASON.tooFine)
    expect(out.rating[2 * 6 + 1]).toBe(LANDING_RATING.green)
    // Only the model that rated a cell is named in the method.
    expect(out.method).toContain('fixture site model')
    expect(out.method).not.toContain('fixture global model')
  })

  it('refuses a spacing that is not a finite number', () => {
    expect(landingFavourability({ ...grid(3, 3, 0), spacingEastKm: Number.POSITIVE_INFINITY }).ok).toBe(false)
  })
})
