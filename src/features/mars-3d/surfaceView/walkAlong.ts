import { MARS_MEAN_RADIUS_KM, type MarsCoordinate, type WalkPlan } from '../../../domain'
import { toPatch, type PatchFrame } from './surfacePatch'

/**
 * Pure maths for walking the planned route in the surface view.
 * The walker follows the planner's own leg paths, vertex to vertex;
 * nothing here plans, smooths or shortens a route.
 */

const RAD = Math.PI / 180

/**
 * The planned line from stop `from` to stop `to`, through every leg in
 * between: forwards along the legs, or backwards along them when `to` is
 * earlier. Null when any leg on the way has no path (UNAVAILABLE): the
 * walker then goes straight to the stop instead of inventing a route.
 */
export function stopsPath(plan: WalkPlan, from: number, to: number): MarsCoordinate[] | null {
  if (from === to) return [plan.stops[to].coordinate]
  const out: MarsCoordinate[] = []
  const step = to > from ? 1 : -1
  for (let i = from; i !== to; i += step) {
    const leg = plan.legs[step > 0 ? i : i - 1]
    if (!leg || leg.path.classification === 'UNAVAILABLE') return null
    const path = step > 0 ? leg.path.value : [...leg.path.value].reverse()
    // Consecutive legs share their stop: keep it once.
    out.push(...(out.length > 0 ? path.slice(1) : path))
  }
  return out
}

/** Farther than this from the route's start, the walker is off the route, metres. */
const ON_ROUTE_M = 5

/**
 * The line to walk from `here` along `planned`, and whether the walker has to
 * be moved onto it first. Only the planned line is ever walked: a straight
 * line from an off-route spot to its start is one nobody planned or checked,
 * so the walker goes there directly, and the panel says so.
 */
export function walkFrom(here: MarsCoordinate | null, planned: MarsCoordinate[]): { path: MarsCoordinate[]; movedToStart: boolean } {
  return { path: planned, movedToStart: here !== null && distanceM(here, planned[0]) > ON_ROUTE_M }
}

/** Great-circle distance in metres on the mean sphere (haversine). */
export function distanceM(a: MarsCoordinate, b: MarsCoordinate): number {
  const dLat = (b.latitude - a.latitude) * RAD
  const dLon = (b.longitudeEast - a.longitudeEast) * RAD
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * RAD) * Math.cos(b.latitude * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * MARS_MEAN_RADIUS_KM * 1000
}

/** Distance from the first vertex to each vertex, metres; the last is the whole length. */
export function cumulativeM(path: readonly MarsCoordinate[]): Float64Array {
  const out = new Float64Array(path.length)
  for (let i = 1; i < path.length; i++) out[i] = out[i - 1] + distanceM(path[i - 1], path[i])
  return out
}

/**
 * Where the walker is `dM` metres along `path`, and the next vertex ahead
 * of it (to face). Clamped to the ends. Vertices are metres apart, so a
 * straight blend between neighbours stays on the planned line; longitude
 * is blended the short way across 0°/360°E.
 */
export function pointAlong(
  path: readonly MarsCoordinate[],
  cumulative: Float64Array,
  dM: number,
): { at: MarsCoordinate; ahead: MarsCoordinate } {
  const last = path.length - 1
  if (last <= 0 || dM <= 0) return { at: path[0], ahead: path[Math.min(1, last)] }
  if (dM >= cumulative[last]) return { at: path[last], ahead: path[last] }
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1
    if (cumulative[mid] <= dM) lo = mid
    else hi = mid
  }
  const a = path[lo]
  const b = path[hi]
  const span = cumulative[hi] - cumulative[lo]
  const t = span > 0 ? (dM - cumulative[lo]) / span : 0
  let dLon = b.longitudeEast - a.longitudeEast
  if (dLon > 180) dLon -= 360
  if (dLon < -180) dLon += 360
  const lon = a.longitudeEast + dLon * t
  return {
    at: { latitude: a.latitude + (b.latitude - a.latitude) * t, longitudeEast: ((lon % 360) + 360) % 360 },
    ahead: b,
  }
}

/** Where the walk driver puts the walker this frame, and the point to face. */
export interface WalkPose {
  at: MarsCoordinate
  ahead: MarsCoordinate
}

/**
 * Puts the walker at `pose` in the patch's metres (x east, y north) and
 * turns it to face `ahead`: yaw 0 north, positive towards east, as the
 * ground's camera uses it. Facing is kept when `ahead` is where it stands.
 */
export function applyWalkPose(
  frame: PatchFrame,
  pose: WalkPose,
  walker: { xM: number; yM: number; yaw: number },
): void {
  const p = toPatch(frame, pose.at)
  const q = toPatch(frame, pose.ahead)
  walker.xM = p.xKm * 1000
  walker.yM = p.yKm * 1000
  const dx = q.xKm - p.xKm
  const dy = q.yKm - p.yKm
  if (Math.hypot(dx, dy) > 1e-6) walker.yaw = Math.atan2(dx, dy)
}
