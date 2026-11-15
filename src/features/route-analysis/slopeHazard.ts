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

/** How a route's stretches are measured, without the thresholds. */
export const ROUTE_SLOPE_MEASURE = `The mean slope of each stretch between neighbouring points of the route's path: the difference of their heights over the ground distance between them, uphill and downhill alike. On a searched route the points are every node the search walked, about one cell of the elevation model apart, so each step is measured on its own; ground steeper over less than a step is not seen, and the search itself walks no step over ${SUITED_SLOPE_LIMIT.deg}°. Neighbouring steep stretches make one warning, at the middle of the steepest`

export const ROUTE_SLOPE_METHOD = `${ROUTE_SLOPE_MEASURE}. ${SLOPE_WARNING_BASIS}`

/**
 * The steep stretches along a route's points. Each run of neighbouring
 * steep stretches is one hazard, with the steepest stretch's mean slope, at
 * that stretch's middle. A stretch with no height at either end is not
 * checked and raises nothing; one of no length (a stop on its own node) is
 * no stretch, and does not split a run. UNAVAILABLE when no stretch could be measured.
 */
export function routeSlopeHazards(points: readonly SurfacePoint[]): Classified<Hazard[]> {
  type Run = { deg: number; from: number; km: number; lengthKm: number }
  const runs: Run[] = []
  let open: Run | null = null
  let measured = 0
  let km = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const runKm = surfaceDistanceKm(a.coordinate, b.coordinate)
    if (!(runKm > 0)) continue
    const startKm = km
    km += runKm
    const deg =
      isAvailable(a.elevationMeters) && isAvailable(b.elevationMeters)
        ? slopeDegrees(b.elevationMeters.value - a.elevationMeters.value, runKm)
        : Number.NaN
    if (!Number.isNaN(deg)) measured++
    if (slopeWarning(deg) === null) {
      open = null
      continue
    }
    if (open === null) {
      open = { deg, from: i, km: startKm, lengthKm: runKm }
      runs.push(open)
    } else {
      open.lengthKm += runKm
      if (deg > open.deg) {
        open.deg = deg
        open.from = i
      }
    }
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
        magnitude: derived(
          run.deg,
          `The steepest stretch of ${describeKm(run.lengthKm)} of steep ground starting ${describeKm(run.km)} along the route. ${ROUTE_SLOPE_METHOD}`,
        ),
      }
    }),
    ROUTE_SLOPE_METHOD,
  )
}
