import { SUITED_SLOPE_LIMIT, derived, isAvailable, unavailable, type Classified, type Hazard, type SurfacePoint } from '../../domain'
import { SLOPE_BANDS, slopeDegrees } from './profileSlope'
import { surfaceDistanceKm } from './routeDistance'
import { describeKm, midpoint } from './terrainSearch'

/**
 * The steep slope warning: one rule for a point's slope and for a
 * route's stretches, so the point menu and the hazards panel never
 * disagree. Two lines, each named for what it is: "steep" is the project's
 * own band, the one the elevation chart colours, and is not an official
 * limit; "over the limit" is the one cited figure for walking in a suit.
 */

/** Where the project's "steep" band starts, degrees. */
export const STEEP_SLOPE_FROM_DEG = SLOPE_BANDS.find((b) => b.band === 'steep')!.fromDeg

export type SlopeWarning = 'steep' | 'over-limit'

/**
 * The warning a slope raises, or null for gentler ground and for no slope.
 * Judged on the figure as shown, one decimal, so "15.0°" always warns and
 * "20.0°" is never "over 20°".
 */
export function slopeWarning(deg: number): SlopeWarning | null {
  if (!Number.isFinite(deg) || deg < 0) return null
  const shown = Number(deg.toFixed(1))
  if (shown > SUITED_SLOPE_LIMIT.deg) return 'over-limit'
  return shown >= STEEP_SLOPE_FROM_DEG ? 'steep' : null
}

/** The warning in a few words, for the line beside the figure. */
export const SLOPE_WARNING_TEXT: Record<SlopeWarning, string> = {
  steep: `Steep ground, ${STEEP_SLOPE_FROM_DEG}° or more`,
  'over-limit': `Over the ${SUITED_SLOPE_LIMIT.deg}° suited walking limit`,
}

/** What the two lines are and where each comes from, for the methodology. */
export const SLOPE_WARNING_BASIS = `A slope of ${STEEP_SLOPE_FROM_DEG}° or more is marked steep: the project's own band, the same one the elevation chart colours, not an official limit. A slope over ${SUITED_SLOPE_LIMIT.deg}° is over the one cited figure for walking in a suit (${SUITED_SLOPE_LIMIT.label}; ${SUITED_SLOPE_LIMIT.source}). A warning means look here, not impassable`

/** The unit of a slope hazard's magnitude. */
export const SLOPE_HAZARD_UNIT = '°'

/** Why the slope scan could not run: no two neighbouring points of the route carry a height. */
export const NO_HEIGHTS_FOR_SLOPE =
  "No two neighbouring points of this route have a height, so the slope along it was not checked (the straight-line option, and a route still being searched, carry none; a searched route's path does)"

/**
 * How much gentler ground two steep stretches may have between them and
 * still be one warning, km. A project choice, not a cited figure: on
 * rough ground the steps of one climb fall either side of the steep line,
 * and a warning for each would bury the list. One gentler stretch of any
 * length also joins, so a coarse model's single step does.
 */
export const STEEP_RUN_GAP_KM = 0.1

/**
 * Under this, two points are one place and the stretch between them is no
 * stretch: a millimetre, km. Not zero: the same stop written either side of
 * 0°/360°E comes out a hair apart, and any height difference over that
 * would read as a cliff.
 */
const NO_LENGTH_KM = 1e-6

/** How a route's stretches are measured, without the thresholds. */
export const ROUTE_SLOPE_MEASURE = `The mean slope of each stretch between neighbouring points of the route's path: the difference of their heights over the ground distance between them, uphill and downhill alike. On a searched route the points are every node the search walked, about one cell of the elevation model apart, so each step is measured on its own; ground steeper over less than a step is not seen, and the search itself walks no step over ${SUITED_SLOPE_LIMIT.deg}°. The slope is along the direction walked: a path that crosses a slope at an angle climbs less than the ground's own steepest slope there, which is not measured. At a stop the route goes on the level to the stop's nearest node, as the search walked it, so the ground between a stop and that node, up to about a step, is not measured either. Steep stretches with under ${describeKm(STEEP_RUN_GAP_KM)} of gentler ground between them, or one gentler stretch, make one warning (a project choice), at the middle of the steepest`

export const ROUTE_SLOPE_METHOD = `${ROUTE_SLOPE_MEASURE}. ${SLOPE_WARNING_BASIS}`

/** A run in words: its steep ground, the reach of route it lies in where gentler ground is inside it, and where it starts. */
function runWords(steepKm: number, reachKm: number, fromKm: number): string {
  // Both in the reach's unit, so "1000 m of steep ground in 1.0 km" is never said; and
  // compared as shown, so neither is "300 m of steep ground in 300 m".
  const length = (km: number) => (describeKm(reachKm).endsWith(' km') ? `${km.toFixed(1)} km` : `${Math.round(km * 1000)} m`)
  const within = length(reachKm) === length(steepKm) ? '' : ` in ${length(reachKm)} of the route`
  return `The steepest stretch of ${length(steepKm)} of steep ground${within} starting ${describeKm(fromKm)} along the route`
}

/**
 * The steep stretches along a route's points. Each run of steep stretches
 * is one hazard, with the steepest stretch's mean slope, at that stretch's
 * middle; a run goes on over gentler ground shorter than STEEP_RUN_GAP_KM,
 * or over one gentler stretch. A stretch with no height at either end is
 * not checked, raises nothing and ends a run: what lies past it is not
 * known to be the same climb. One of no length (a stop on its own node) is
 * no stretch, and does not split a run. UNAVAILABLE when no stretch could be measured.
 */
export function routeSlopeHazards(points: readonly SurfacePoint[]): Classified<Hazard[]> {
  /** `steepKm` is the steep ground itself; `endKm` where its last steep stretch ends, so the run's reach is endKm − km. */
  type Run = { deg: number; from: number; km: number; steepKm: number; endKm: number }
  const runs: Run[] = []
  let open: Run | null = null
  /** The gentler ground since the open run's last steep stretch: its length and its stretches. */
  let gapKm = 0
  let gapStretches = 0
  let measured = 0
  let km = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const runKm = surfaceDistanceKm(a.coordinate, b.coordinate)
    if (!(runKm > NO_LENGTH_KM)) continue
    const startKm = km
    km += runKm
    const deg =
      isAvailable(a.elevationMeters) && isAvailable(b.elevationMeters)
        ? slopeDegrees(b.elevationMeters.value - a.elevationMeters.value, runKm)
        : Number.NaN
    if (Number.isNaN(deg)) {
      open = null
      continue
    }
    measured++
    if (slopeWarning(deg) === null) {
      gapKm += runKm
      gapStretches++
      if (gapStretches > 1 && gapKm >= STEEP_RUN_GAP_KM) open = null
      continue
    }
    if (open === null) {
      open = { deg, from: i, km: startKm, steepKm: runKm, endKm: km }
      runs.push(open)
    } else {
      open.steepKm += runKm
      open.endKm = km
      if (deg > open.deg) {
        open.deg = deg
        open.from = i
      }
    }
    gapKm = 0
    gapStretches = 0
  }
  if (measured === 0) return unavailable(NO_HEIGHTS_FOR_SLOPE)
  return derived(
    runs.map((run, n): Hazard => {
      const a = points[run.from - 1].coordinate
      const b = points[run.from].coordinate
      return {
        id: `route-slope-${n + 1}`,
        kind: 'slope',
        unit: SLOPE_HAZARD_UNIT,
        // Wrapped, so a stretch across 0°/360°E has its middle between its ends, not at 180°E.
        coordinate: midpoint(a, b),
        magnitude: derived(run.deg, `${runWords(run.steepKm, run.endKm - run.km, run.km)}. ${ROUTE_SLOPE_METHOD}`),
      }
    }),
    ROUTE_SLOPE_METHOD,
  )
}
