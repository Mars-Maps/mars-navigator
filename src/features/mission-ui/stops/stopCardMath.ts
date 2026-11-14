import {
  isAvailable,
  unavailable,
  type Classified,
  type GeologicUnit,
  type Hazard,
  SUITED_SLOPE_LIMIT,
  type RoverId,
  type SlopeLimit,
  type SurfaceImage,
  type WalkPlan,
} from '../../../domain'
import type { PhotoNearby } from '../../route-analysis/photoPositions'
import { ROUTE_ONLY } from '../hud/hudMath'
import type { RouteWaypoint } from '../hud/routeWaypoints'
import { READING_GEOLOGIC_UNIT_REASON } from '../pointFields'

/**
 * The stop card's maths: which rover photos to show beside a stop,
 * and how its figures read. Pure, so the card only lays them out.
 */

/** What the shared plan says about one stop, for the card. */
export interface StopPlanFacts {
  label: string
  unit: Classified<GeologicUnit>
  /** Why the goal leads here; null for a route waypoint, which the user chose, so the card leaves the row out. */
  reason: Classified<string> | null
  /** The leg into the stop, as the route strategy measured it; null at the first stop, where the walk starts. */
  fromPreviousKm: Classified<number> | null
  /**
   * The steepest stretch of the leg into the stop, as the planner measured
   * it, or on a route as its elevation profile shows it; null at the
   * first stop.
   */
  legSteepestSlopeDeg: Classified<number> | null
  /** The planner's hazards on the leg into the stop: radiation, mapped obstacles and the rest; null at the first stop. */
  legHazards: Classified<Hazard[]> | null
  slopeLimit: SlopeLimit
}

/**
 * The card's props that come from the plan, for stop `index`: its name,
 * unit and reason, the distance, steepest slope and hazards of the leg into it, and the
 * plan's slope limit. Null for an index the plan does not have. Elevation, slope at the
 * stop and photos are not in the plan; the host reads them elsewhere (the
 * elevation chain and its slope read, the photo join).
 */
export function stopPlanFacts(plan: WalkPlan, index: number): StopPlanFacts | null {
  const stop = plan.stops[index]
  if (!stop) return null
  const leg = index === 0 ? undefined : plan.legs[index - 1]
  const noLeg = 'The plan has no leg into this stop'
  return {
    label: stop.label,
    unit: stop.unit,
    reason: stop.reason,
    fromPreviousKm: index === 0 ? null : (leg?.distanceKm ?? unavailable<number>(noLeg)),
    legSteepestSlopeDeg: index === 0 ? null : (leg?.steepestSlopeDeg ?? unavailable<number>(noLeg)),
    legHazards: index === 0 ? null : (leg?.hazards ?? unavailable<Hazard[]>(noLeg)),
    slopeLimit: plan.slopeLimit,
  }
}

/** What the card says of a route waypoint where a walk stop would have the planner's figures. */
export const ROUTE_WAYPOINT_ONLY = {
  distance: 'Route only: the route’s distance is for the whole route (the destination bar), not per leg',
} as const

/**
 * A route waypoint as the card shows it while standing on a followed route
 * with no walk plan: its name and place, the unit the shell
 * read there as the point menu reads it (null while it is being read), and
 * the steepest stretch of the route's elevation profile on the way in. The
 * user chose the waypoint, so there is no reason to give and the card leaves
 * that row out; the leg's distance and hazards are the whole route's, so
 * they say they are route-only. The ground reads and the photos come from
 * the shell as for a stop. null for an index with no waypoint.
 */
export function routeStopFacts(
  waypoints: readonly RouteWaypoint[],
  index: number,
  unit: Classified<GeologicUnit> | null,
): StopPlanFacts | null {
  const waypoint = waypoints[index]
  if (!waypoint) return null
  const first = index === 0
  return {
    label: waypoint.label,
    unit: unit ?? unavailable(READING_GEOLOGIC_UNIT_REASON),
    reason: null,
    fromPreviousKm: first ? null : unavailable(ROUTE_WAYPOINT_ONLY.distance),
    legSteepestSlopeDeg: first ? null : (waypoint.legSteepestSlopeDeg ?? unavailable<number>('No leg leads to this waypoint')),
    legHazards: first ? null : unavailable<Hazard[]>(ROUTE_ONLY.hazards),
    slopeLimit: SUITED_SLOPE_LIMIT,
  }
}

/** Thumbnails a card shows, one row at its width; the rest are counted. The photo strip shows them all. */
export const STOP_CARD_PHOTOS = 3

/**
 * The photos to show and how many more there are: only those with a known
 * distance within the radius, nearest first. A photo whose distance is
 * unknown, or beyond the radius, is not "near" the stop, so it is left out
 * rather than shown as if it were. The host passes `photosNear` as
 * is; that already filters and sorts, and this checks again so a card given
 * any list never shows a far or unplaced photo.
 */
export function photosToShow(
  photos: readonly PhotoNearby[],
  radiusM: number,
  max = STOP_CARD_PHOTOS,
): { shown: PhotoNearby[]; more: number } {
  const near = photos
    .filter((p) => isAvailable(p.distanceM) && Number.isFinite(p.distanceM.value) && p.distanceM.value >= 0 && p.distanceM.value <= radiusM)
    .sort((a, b) => metres(a) - metres(b))
  return { shown: near.slice(0, max), more: Math.max(0, near.length - max) }
}

function metres(p: PhotoNearby): number {
  return isAvailable(p.distanceM) ? p.distanceM.value : Number.POSITIVE_INFINITY
}

/** "350 m" under 1 km, "1.2 km" beyond. */
export function formatDistanceM(m: number): string {
  const whole = Math.round(m)
  return whole < 1000 ? `${whole} m` : `${(m / 1000).toFixed(1)} km`
}

/** "-2,540 m", as the elevation chart writes heights. */
export function formatElevation(m: number): string {
  return `${Math.round(m).toLocaleString('en-US')} m`
}

const ROVER_NAMES: Record<RoverId, string> = { perseverance: 'Perseverance', curiosity: 'Curiosity' }

/** "Perseverance NAVCAM_RIGHT, sol 123": the camera as NASA names it. */
export function photoTitle(image: SurfaceImage): string {
  return `${ROVER_NAMES[image.rover]} ${image.camera}, sol ${image.sol}`
}

/**
 * A height to show: any finite figure, as heights below the areoid are
 * negative (Jezero's floor is about -2,500 m). Anything else would print
 * as "NaN m", so it shows as unavailable instead.
 */
export function shownElevation(m: Classified<number>): Classified<number> {
  if (!isAvailable(m) || Number.isFinite(m.value)) return m
  return unavailable('The elevation is not a finite number')
}

/** A distance to show: finite and not negative, else unavailable, never "NaN m" or "-1000 m". */
export function shownDistance(d: Classified<number>): Classified<number> {
  if (!isAvailable(d) || (Number.isFinite(d.value) && d.value >= 0)) return d
  return unavailable('The distance is not a finite, unsigned number')
}

/** Photos null because they were never read: no search ran, so the card never says "none found". */
export const PHOTOS_NOT_READ_REASON = 'The rover photos have not been read, so nothing was searched'

/**
 * Photos read, but the rover's path was not, so the join could place none
 * of them (the join gives each an UNAVAILABLE position). The host passes null
 * with this reason, since an empty list would read as "none within N m".
 */
export const PHOTOS_NOT_PLACED_REASON = "The rover's path has not been read, so no photo could be placed near this stop"

/** "No rover photos within 200 m": honest about the radius searched. */
export function noPhotosText(radiusM: number): string {
  return `No rover photos within ${formatDistanceM(radiusM)}`
}
