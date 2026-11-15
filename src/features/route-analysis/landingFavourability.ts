import { SLOPE_SPACING_CELLS, type SlopeModel } from './pointSlope'

/**
 * Landing favourability: each cell of the site's ground rated green,
 * yellow or red by how favourable it is to land on, from its slope and
 * whether it lies inside the crater. Flatter is better, and green only on
 * flat ground inside the crater.
 *
 * Pure: the shell reads the heights through the elevation chain and works
 * out "inside the crater" from the site's geologic map (SIM 3464 units
 * inside the Jezero rim); this function reads neither.
 *
 * The colour is a project rating on slope and the crater only, never a
 * statement that a landing is safe: rocks, dust, thermal inertia and the
 * rest are not looked at.
 */

/**
 * At or below this slope a cell is flat. A project choice: no published
 * landing-site slope figure was found and verified for this rating, so none
 * is quoted. Replace with a cited figure if one is adopted.
 */
export const FLAT_MAX_DEG = 5

/** At or above this slope a cell is steep. A project choice, as `FLAT_MAX_DEG`. */
export const STEEP_MIN_DEG = 15

/** Per-cell rating codes in `LandingFavourability.rating`. */
export const LANDING_RATING = { unavailable: 0, green: 1, yellow: 2, red: 3 } as const
export type LandingRating = keyof typeof LANDING_RATING

/** Per-cell codes in `LandingFavourability.reason`: why a cell is unavailable, 0 when it is rated. */
export const LANDING_REASON = { none: 0, noHeight: 1, edge: 2, seam: 3, tooFine: 4, unknownModel: 5 } as const

/** The text each unavailable reason shows. */
export const LANDING_REASON_TEXT: Record<Exclude<(typeof LANDING_REASON)[keyof typeof LANDING_REASON], 0>, string> = {
  [LANDING_REASON.noHeight]: 'No rating: the elevation models have no height at this ground or around it',
  [LANDING_REASON.edge]: 'No rating at the edge of the grid: the slope needs the ground on every side',
  [LANDING_REASON.seam]:
    'No rating at the edge of a detailed elevation model: the heights around this ground come from a site model and the global one, and the step between them would read as a slope',
  [LANDING_REASON.tooFine]:
    'No rating: the grid is finer than the elevation model here, so neighbouring cells share one height and would read as flat',
  [LANDING_REASON.unknownModel]: 'No rating: a height came from an elevation model the rating does not know',
}

/** The text for an unavailable reason's code, or null for 0 and for a code this does not know. */
export function landingReasonText(code: number): string | null {
  for (const known of [1, 2, 3, 4, 5] as const) if (known === code) return LANDING_REASON_TEXT[known]
  return null
}

/** The lines the legend shows, thresholds and their standing included. */
export const LANDING_LEGEND = {
  green: `Flat (slope ${FLAT_MAX_DEG}° or less) and inside the crater`,
  yellow: `Flat outside the crater, or a moderate slope (over ${FLAT_MAX_DEG}° and under ${STEEP_MIN_DEG}°)`,
  red: `Steep (slope ${STEEP_MIN_DEG}° or more)`,
  unavailable: 'No rating: no height, the grid edge, the edge of a detailed elevation model, or a grid finer than the elevation model',
  note: `A project rating on slope and the crater only, not a statement that a landing is safe. The ${FLAT_MAX_DEG}° and ${STEEP_MIN_DEG}° thresholds are project choices, not published landing limits.`,
} as const

/** The ground to rate: a lattice of heights, rows north to south, each west to east. */
export interface LandingGrid {
  cols: number
  rows: number
  /** Spacing of the lattice, km: between columns (east–west) and between rows (north–south). One figure each for the whole grid: over a site's sheet the east–west spacing of a lattice in degrees changes by well under 1%. */
  spacingEastKm: number
  spacingNorthKm: number
  /** Metres, `rows × cols`, row-major; NaN where no model has a height. */
  heights: ArrayLike<number>
  /** Index into `models` per cell; ignored where the height is NaN. */
  model: ArrayLike<number>
  models: readonly SlopeModel[]
  /** More than 0 where the cell is inside the crater, from the site's geologic map. 0 or NaN (not known) is not inside, so never green. */
  insideCrater: ArrayLike<number>
}

export interface LandingFavourability {
  cols: number
  rows: number
  /** `LANDING_RATING` code per cell. */
  rating: Uint8Array
  /** `LANDING_REASON` code per cell: why it is unavailable, 0 where rated. */
  reason: Uint8Array
  /** The slope each cell was judged on, degrees; NaN where unavailable. DERIVED by `method`. */
  slopeDeg: Float32Array
  /** How the slope and the rating were worked out, for the DERIVED badge. */
  method: string
}

export type LandingAnswer = ({ ok: true } & LandingFavourability) | { ok: false; reason: string }

/** The rating of one cell from its slope and whether it is inside the crater. */
export function rateCell(slopeDeg: number, inside: boolean): LandingRating {
  if (!Number.isFinite(slopeDeg)) return 'unavailable'
  if (slopeDeg >= STEEP_MIN_DEG) return 'red'
  if (slopeDeg <= FLAT_MAX_DEG) return inside ? 'green' : 'yellow'
  return 'yellow'
}

/**
 * Rates every cell of `grid`. The slope is Horn's 3×3 slope on the
 * lattice, as `slopeAtPoint` works it at one point: UNAVAILABLE, never 0,
 * where a height is missing, at the grid's edge, where the window mixes a
 * site model with the global one (a seam), or where the lattice is finer
 * than `SLOPE_SPACING_CELLS` cells of the coarsest model in the window.
 *
 * Cost: one pass, about a quarter of a microsecond per cell. A 256 × 256
 * lattice is a few tens of ms; 1024 × 1024 was 240–310 ms on a busy laptop
 * (13 Nov), over a frame budget, so the caller rates a lattice that large
 * in a worker or rates a coarser one.
 */
export function landingFavourability(grid: LandingGrid): LandingAnswer {
  const { cols, rows, spacingEastKm, spacingNorthKm, heights, model, models, insideCrater } = grid
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
    return { ok: false, reason: `A grid of ${cols} × ${rows} cells is not a grid` }
  }
  if (!(spacingEastKm > 0) || !(spacingNorthKm > 0) || !Number.isFinite(spacingEastKm) || !Number.isFinite(spacingNorthKm)) {
    return { ok: false, reason: 'The grid spacing must be a number of km more than 0' }
  }
  const n = cols * rows
  if (heights.length !== n || model.length !== n || insideCrater.length !== n) {
    return { ok: false, reason: `A ${cols} × ${rows} grid needs ${n} heights, models and crater flags` }
  }

  const rating = new Uint8Array(n)
  const reason = new Uint8Array(n)
  const slopeDeg = new Float32Array(n).fill(Number.NaN)
  const dxM = spacingEastKm * 1000
  const dyM = spacingNorthKm * 1000
  const minSpacingKm = Math.min(spacingEastKm, spacingNorthKm)
  const modelCount = models.length
  // A little slack, so a lattice laid out from this very model is not refused for rounding.
  const tooFine = models.map((m) => !(m.cellKm > 0) || m.cellKm * SLOPE_SPACING_CELLS > minSpacingKm * (1 + 1e-9))
  const site = models.map((m) => m.site)
  // Which models gave a rated cell its heights, for the method text: a flag per model, set as the windows are read.
  const used = new Uint8Array(modelCount)

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c
      if (Number.isNaN(heights[k])) {
        reason[k] = LANDING_REASON.noHeight
        continue
      }
      if (r === 0 || c === 0 || r === rows - 1 || c === cols - 1) {
        reason[k] = LANDING_REASON.edge
        continue
      }
      const why = windowProblem(heights, model, k, cols, modelCount, tooFine, site, used)
      if (why !== LANDING_REASON.none) {
        reason[k] = why
        continue
      }
      const a = heights[k - cols - 1], b = heights[k - cols], cc = heights[k - cols + 1]
      const d = heights[k - 1], f = heights[k + 1]
      const g = heights[k + cols - 1], h = heights[k + cols], i = heights[k + cols + 1]
      // Horn 1981, as `hornSlopeDegrees`, with the east and north spacings apart.
      const east = (cc + 2 * f + i - (a + 2 * d + g)) / (8 * dxM)
      const north = (a + 2 * b + cc - (g + 2 * h + i)) / (8 * dyM)
      const s = (Math.atan(Math.hypot(east, north)) * 180) / Math.PI
      slopeDeg[k] = s
      // `> 0`, so a NaN flag (membership not known) is not inside.
      rating[k] = LANDING_RATING[rateCell(s, insideCrater[k] > 0)]
    }
  }

  return { ok: true, cols, rows, rating, reason, slopeDeg, method: landingMethod(grid, models.filter((_, m) => used[m] === 1)) }
}

/**
 * Why the 3×3 window around cell `k` cannot give a slope, or `none`; a
 * window that can marks its models in `used`. A seam is named before a
 * too-fine lattice: beside a site model both hold, and the seam is the
 * reason that tells the user where they are.
 */
function windowProblem(
  heights: ArrayLike<number>,
  model: ArrayLike<number>,
  k: number,
  cols: number,
  modelCount: number,
  tooFine: readonly boolean[],
  site: readonly boolean[],
  used: Uint8Array,
): number {
  const first = model[k]
  let mixed = false
  let allSite = true
  let fine = false
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const j = k + dr * cols + dc
      if (!Number.isFinite(heights[j])) return LANDING_REASON.noHeight
      const m = model[j]
      if (!Number.isInteger(m) || m < 0 || m >= modelCount) return LANDING_REASON.unknownModel
      if (tooFine[m]) fine = true
      if (m !== first) mixed = true
      if (!site[m]) allSite = false
    }
  }
  if (mixed && !allSite) return LANDING_REASON.seam
  if (fine) return LANDING_REASON.tooFine
  // Every model in a clean window is a site model or the one model at `first`: mark what was read.
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) used[model[k + dr * cols + dc]] = 1
  return LANDING_REASON.none
}

function landingMethod(grid: LandingGrid, used: readonly SlopeModel[]): string {
  const sources = used.length === 0 ? 'no heights rated' : used.map((m) => m.source).join(' | ')
  return `Slope per cell by Horn's 3×3 method (Horn 1981; the default in GDAL and ArcGIS) on a lattice ${round(grid.spacingEastKm * 1000)} m east–west by ${round(grid.spacingNorthKm * 1000)} m north–south, so each slope is the mean over about two spacings of ground and rougher ground within that can be steeper. Rated green at ${FLAT_MAX_DEG}° or less inside the crater, yellow at ${FLAT_MAX_DEG}° or less outside it or between ${FLAT_MAX_DEG}° and ${STEEP_MIN_DEG}°, red at ${STEEP_MIN_DEG}° or more; both thresholds are project choices, not published landing limits. Inside the crater from the site's geologic map. A project rating, not a statement that a landing is safe. Heights: ${sources}`
}

const round = (n: number) => Number(n.toPrecision(3))
