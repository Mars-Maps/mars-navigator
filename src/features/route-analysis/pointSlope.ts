import { MARS_MEAN_RADIUS_KM, derived, unavailable, validateCoordinate, type Classified, type MarsCoordinate } from '../../domain'

/**
 * Slope at a point: how steep the ground is at the selected point,
 * from the elevation models' heights on a 3×3 grid around it.
 *
 * The shell reads the nine heights, each with the model it came from, and
 * asks `slopeAtPoint`. The grid's spacing is tied to the model's cell size,
 * so the answer may be "read again, wider": a fine site model with a gap
 * at the point hands the heights to a coarser model, and nine samples a
 * fine cell apart would then fall in one coarse cell and read as flat.
 */

/** Samples are this many cells of the coarsest model used apart, so a nearest-cell lookup lands in distinct cells. */
export const SLOPE_SPACING_CELLS = 2

/** Nearer a pole than this, the east–west spacing in degrees blows up; no slope. */
const MAX_ABS_LATITUDE = 85

/** One model of the elevation chain, as the slope needs it. */
export interface SlopeModel {
  /** Its cell size, km. */
  cellKm: number
  /** Its provenance line, for the method text. */
  source: string
  /**
   * A regional model of one site, built to one control net with the site's
   * other models: the Jezero HiRISE and CTX models state a median offset of
   * about 0.4 m from each other, so a kernel may mix them. The global model
   * is not one: the CTX model and the global DEM differ by 13 m typically
   * and up to 72 m near the CTX box's edge (measured 2026-10-28), and that
   * step would read as a slope.
   */
  site: boolean
}

/** The nine heights read at `slopeSamplePoints`, in its order. */
export interface SlopeRead {
  /** Metres; NaN where no model has a height. */
  heights: ArrayLike<number>
  /** Index into `models` per height; ignored where the height is NaN. */
  model: ArrayLike<number>
  models: readonly SlopeModel[]
}

export type SlopeAnswer =
  | { kind: 'slope'; slope: Classified<number> }
  /** The heights came from a coarser model than the spacing was set for: read again at `spacingKm`. */
  | { kind: 'read-again'; spacingKm: number }

/** Where the spacing starts, km: for the finest model whose grid holds the point. */
export function initialSpacingKm(cellKm: number): number {
  return cellKm * SLOPE_SPACING_CELLS
}

/**
 * The 3×3 grid around `centre`, `spacingKm` apart, as (latitude, longitude °E)
 * pairs: rows north to south, each west to east, the centre fifth. Spacing
 * is on a sphere of MARS_MEAN_RADIUS_KM, east–west scaled by cos(latitude),
 * and longitudes wrap into 0–360°E. Null when the centre is not a valid
 * coordinate or is within 5° of a pole.
 */
export function slopeSamplePoints(centre: MarsCoordinate, spacingKm: number): Float64Array | null {
  if (!validateCoordinate(centre).ok || Math.abs(centre.latitude) > MAX_ABS_LATITUDE || !(spacingKm > 0)) return null
  const kmPerDegLat = (MARS_MEAN_RADIUS_KM * Math.PI) / 180
  const dLat = spacingKm / kmPerDegLat
  const dLon = spacingKm / (kmPerDegLat * Math.cos((centre.latitude * Math.PI) / 180))
  const points = new Float64Array(18)
  let i = 0
  for (const row of [1, 0, -1]) {
    for (const col of [-1, 0, 1]) {
      points[i++] = centre.latitude + row * dLat
      // Wrapped only when it crosses 0/360°E, so the centre stays exactly the point asked for.
      const lon = centre.longitudeEast + col * dLon
      points[i++] = lon < 0 ? lon + 360 : lon >= 360 ? lon - 360 : lon
    }
  }
  return points
}

/** Why there is no slope at a point that is too near a pole, or not a coordinate. */
export const NO_SLOPE_NEAR_POLE_REASON =
  'No slope this near a pole: the grid of heights around the point cannot be laid out on a flat plane here'

/**
 * The slope at the centre of a `SlopeRead`, or a request to read again
 * wider. UNAVAILABLE, never 0, when a height is missing or the grid mixes
 * a site model with the global one: where they meet their heights differ
 * by tens of metres, and that step would read as a slope. The site's own
 * models may mix (`SlopeModel.site`), and the method then names each.
 *
 * `noDataReason` is the chain's own reason for a point with no height.
 */
export function slopeAtPoint(read: SlopeRead, spacingKm: number, noDataReason: string): SlopeAnswer {
  if (read.heights.length !== 9 || read.model.length !== 9) {
    return { kind: 'slope', slope: unavailable('The slope needs nine heights around the point') }
  }
  if (Number.isNaN(read.heights[4])) return { kind: 'slope', slope: unavailable(noDataReason) }
  for (let i = 0; i < 9; i++) {
    if (!Number.isFinite(read.heights[i])) {
      return {
        kind: 'slope',
        slope: unavailable('No slope: the elevation models have no height at some of the ground around the point'),
      }
    }
  }

  const used = new Set<number>()
  for (let i = 0; i < 9; i++) used.add(read.model[i])
  let coarsestKm = 0
  for (const m of used) {
    const model = read.models[m]
    if (model === undefined || !(model.cellKm > 0)) {
      return { kind: 'slope', slope: unavailable('A height came from an elevation model the slope does not know') }
    }
    coarsestKm = Math.max(coarsestKm, model.cellKm)
  }
  const needKm = coarsestKm * SLOPE_SPACING_CELLS
  // A little slack, so a spacing already set from this very model is not read again for rounding.
  if (needKm > spacingKm * (1 + 1e-9)) return { kind: 'read-again', spacingKm: needKm }
  const models = [...used].map((m) => read.models[m]).sort((a, b) => a.cellKm - b.cellKm)
  if (models.length > 1 && !models.every((m) => m.site)) {
    return {
      kind: 'slope',
      slope: unavailable(
        'No slope at the edge of a detailed elevation model: the heights around the point come from a site model and the global one, and the step between them would read as a slope',
      ),
    }
  }

  const deg = hornSlopeDegrees(read.heights, spacingKm * 1000)
  return { kind: 'slope', slope: derived(deg, slopeMethod(spacingKm, models)) }
}

/**
 * Horn's 3×3 slope, degrees, from heights in metres on a grid `spacingM`
 * apart, rows north to south and west to east. Each gradient weights the
 * middle row or column twice (Horn 1981, the default in GDAL and ArcGIS).
 */
export function hornSlopeDegrees(z: ArrayLike<number>, spacingM: number): number {
  const [a, b, c, d, , f, g, h, i] = Array.from({ length: 9 }, (_, k) => z[k])
  const east = (c + 2 * f + i - (a + 2 * d + g)) / (8 * spacingM)
  const north = (a + 2 * b + c - (g + 2 * h + i)) / (8 * spacingM)
  return (Math.atan(Math.hypot(east, north)) * 180) / Math.PI
}

/** `models` are the ones used, finest first; more than one only when all are the site's. */
function slopeMethod(spacingKm: number, models: readonly SlopeModel[]): string {
  const spacing = spacingKm < 1 ? `${round(spacingKm * 1000)} m` : `${round(spacingKm)} km`
  const across = spacingKm * 2 < 1 ? `${round(spacingKm * 2000)} m` : `${round(spacingKm * 2)} km`
  const cells = models.length > 1 ? 'cells of the coarsest model used' : 'cells of the model'
  const heights =
    models.length > 1
      ? `Heights from ${models.length} models of the site, each point's from the finest with data there; they share one datum and control net, and each one's line states its offset from the other: ${models.map((m) => `${modelCell(m)}: ${m.source}`).join(' | ')}`
      : `Heights: ${models[0].source}`
  return `Steepest slope at the point by Horn's 3×3 method (Horn 1981; the default in GDAL and ArcGIS): the nearest cell's height at nine points ${spacing} apart (${SLOPE_SPACING_CELLS} ${cells}), so the slope is the mean over about ${across} of ground. Ground rougher than that, a boulder or a crater wall, can be steeper than this figure. ${heights}`
}

const modelCell = (m: SlopeModel) => (m.cellKm < 1 ? `${round(m.cellKm * 1000)} m cells` : `${round(m.cellKm)} km cells`)

const round = (n: number) => Number(n.toPrecision(3))
