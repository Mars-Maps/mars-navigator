import {
  derived,
  isAvailable,
  simulated,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type RouteOption,
  type RouteRequest,
} from '../../../domain'
import type { ElevationProfile } from '../../route-analysis/elevationProfile'
import { SLOPE_METHOD, slopeDegrees } from '../../route-analysis/profileSlope'
import { surfaceDistanceKm } from '../../route-analysis/routeDistance'

/**
 * The waypoints of a followed route that the HUD and the stop card walk
 * through: the user's own, departure, stops and destination, never a
 * point a strategy added. The scientific route puts its science stops into
 * `points` between the departure and the user's stops, and they carry no
 * label, so a plain route stood on read "Departure, Stop 1, Destination"
 * with a Stop 1 nobody set. The user's stops are found by matching the
 * request the search bar holds, point for point, in order.
 */
export interface RouteWaypoint {
  /** Departure, Stop n or Destination, as the search bar names them; a label the point carries wins. */
  label: string
  coordinate: MarsCoordinate
  /**
   * The steepest stretch of the route's elevation profile on the path from
   * the previous waypoint to this one, degrees (`legSteepestSlopes`); null
   * at the departure, where the walk starts.
   */
  legSteepestSlopeDeg: Classified<number> | null
}

/**
 * What makes two followed routes the same to the walk guide: the
 * user's waypoints, place by place, in order. The route option's id cannot
 * say it (`option-<strategy>` for every request), so a new request with the
 * same strategy kept the last route's aim. Exact coordinates, as
 * `routeWaypoints` matches them.
 */
export function waypointsKey(waypoints: readonly RouteWaypoint[]): string {
  return waypoints.map((w) => `${w.coordinate.latitude},${w.coordinate.longitudeEast}`).join(';')
}

/** Why a waypoint's leg has no slope while the profile has no heights to give. */
export const NO_PROFILE_REASON = 'No elevation profile of the route'

/** The same place: exactly equal, or equal across 0°/360°E. The points are copies of the request's, so never "close enough". */
function samePlace(a: MarsCoordinate, b: MarsCoordinate): boolean {
  return a.latitude === b.latitude && (a.longitudeEast - b.longitudeEast) % 360 === 0
}

/**
 * The user's waypoints of `route` in walking order: its first point (the
 * departure), each of the request's stops found among the points in order,
 * and its last point (the destination). Every strategy keeps the request's
 * ends as its first and last points; a stop is named by its place in the
 * search bar ("Stop 2" is the search bar's second stop), and one not found
 * on the route is left out rather than guessed. With no request, only the
 * two ends. Slopes come from `profile` (`legSteepestSlopes`).
 */
export function routeWaypoints(
  route: RouteOption,
  request: RouteRequest | null,
  profile: Classified<ElevationProfile> | null,
): RouteWaypoint[] {
  const points = route.points
  if (points.length === 0) return []
  const last = points.length - 1
  const picked: { index: number; name: string }[] = [{ index: 0, name: 'Departure' }]
  let from = 1
  request?.stops.forEach((stop, s) => {
    for (let j = from; j < last; j++) {
      if (samePlace(points[j].coordinate, stop)) {
        picked.push({ index: j, name: `Stop ${s + 1}` })
        from = j + 1
        return
      }
    }
  })
  if (last > 0) picked.push({ index: last, name: 'Destination' })
  const slopes = legSteepestSlopes(
    route,
    picked.map((p) => points[p.index].coordinate),
    profile,
  )
  return picked.map((p, i) => ({
    label: points[p.index].label ?? p.name,
    coordinate: points[p.index].coordinate,
    legSteepestSlopeDeg: i === 0 ? null : slopes[i - 1],
  }))
}

/** Profile distances within this of a waypoint's count as at it: the plan and this sum the same legs, to float error. */
const ALONG_TOLERANCE_KM = 1e-6

/**
 * For each leg between consecutive `waypoints`, the steepest stretch of the
 * route's elevation profile along it: the profile's own per-stretch slope
 * (the chart's, `slopeDegrees` between consecutive samples), so the card
 * and the chart agree. Each waypoint is found on the route's DERIVED path
 * (the strategies put the waypoints on it exactly) and its distance along
 * the path matched to the profile's samples. UNAVAILABLE, with the reason,
 * where the route has no path, the profile is not read or is of another
 * path, or any stretch of the leg has no height: the steepest of a leg
 * partly unread is unknown, as `walkLegs` says of a walk's leg.
 */
export function legSteepestSlopes(
  route: RouteOption,
  waypoints: readonly MarsCoordinate[],
  profile: Classified<ElevationProfile> | null,
): Classified<number>[] {
  const legs = Math.max(0, waypoints.length - 1)
  const all = (reason: string) => Array.from({ length: legs }, () => unavailable<number>(reason))
  if (route.path.classification === 'UNAVAILABLE') {
    return all(`The route has no planned path to measure slopes along: ${route.path.reason}`)
  }
  if (route.path.classification !== 'DERIVED') return all('The route’s path has no stated method')
  if (profile === null) return all(NO_PROFILE_REASON)
  if (profile.classification === 'UNAVAILABLE') return all(`${NO_PROFILE_REASON}: ${profile.reason}`)
  if (profile.classification !== 'DERIVED') return all('The route’s elevation profile has no stated method')

  const path = route.path.value.map((p) => p.coordinate)
  const alongKm = [0]
  for (let i = 1; i < path.length; i++) alongKm.push(alongKm[i - 1] + surfaceDistanceKm(path[i - 1], path[i]))
  const totalKm = alongKm[alongKm.length - 1] ?? 0
  if (Math.abs(totalKm - profile.value.totalDistanceKm) > ALONG_TOLERANCE_KM * Math.max(1, totalKm)) {
    return all('The elevation profile is of another path than the route’s; it is being read again')
  }
  const at: (number | null)[] = []
  let from = 0
  for (const w of waypoints) {
    const j = path.findIndex((c, k) => k >= from && samePlace(c, w))
    at.push(j < 0 ? null : alongKm[j])
    if (j >= 0) from = j
  }

  const { samples } = profile.value
  const method = `Steepest stretch of the route’s elevation profile from the previous waypoint to this one, along the planned path: ${SLOPE_METHOD} Profile: ${profile.method}`
  return Array.from({ length: legs }, (_, l) => {
    const a = at[l]
    const b = at[l + 1]
    if (a === null || b === null) return unavailable<number>('This waypoint is not on the route’s planned path')
    const leg = samples.filter((s) => s.distanceKm >= a - ALONG_TOLERANCE_KM && s.distanceKm <= b + ALONG_TOLERANCE_KM)
    let steepest = Number.NEGATIVE_INFINITY
    let anySimulated = false
    for (let i = 1; i < leg.length; i++) {
      const e0 = leg[i - 1].elevationMeters
      const e1 = leg[i].elevationMeters
      if (!isAvailable(e0) || !isAvailable(e1)) {
        return unavailable<number>('No steepest slope: the elevation models have no height on part of the way here')
      }
      anySimulated ||= e0.classification === 'SIMULATED' || e1.classification === 'SIMULATED'
      const deg = slopeDegrees(e1.value - e0.value, leg[i].distanceKm - leg[i - 1].distanceKm)
      // A stretch of no length has no slope; the chart draws it plain, and so it is skipped here.
      if (Number.isFinite(deg)) steepest = Math.max(steepest, deg)
    }
    if (!Number.isFinite(steepest)) return unavailable<number>('The way here is too short to have a slope')
    return anySimulated ? simulated(steepest, method) : derived(steepest, method)
  })
}
