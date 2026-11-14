import {
  MARS_MEAN_RADIUS_KM,
  derived,
  isAvailable,
  unavailable,
  type Classified,
  type MarsCoordinate,
  type RoverTraverse,
} from '../../domain'
import { pointAlong } from './elevationProfile'
import { surfaceDistanceKm } from './routeDistance'

/**
 * Proven ground: how close each stretch of a walk stays to the path
 * a rover has already driven. A statement of distance, never of safety:
 * the rover crossing ground says nothing of how it is to walk on.
 */

/**
 * For each stretch of `path` (consecutive points), a distance in metres
 * that no point of the stretch is farther than from the rover's path:
 * DERIVED, with the method.
 *
 * The rover's path is the straight lines between its consecutive published
 * waypoints. The distance to it is measured at the stretch's two ends and
 * its middle; since the distance changes by at most one metre per metre
 * walked, the farthest of the three plus a quarter of the stretch's length
 * bounds the whole stretch. Distances are worked in a plane tangent at each
 * measured point, good to well under 1% within a few km.
 */
export function provenGround(path: readonly MarsCoordinate[], traverse: RoverTraverse): Classified<number>[] {
  const stretches = Math.max(0, path.length - 1)
  if (traverse.points.length === 0) {
    return Array.from({ length: stretches }, () =>
      unavailable<number>(`The ${traverse.rover} traverse has no waypoints, so no distance to it can be given`),
    )
  }
  const rover = traverse.points.map((p) => p.coordinate)
  const method = `Upper bound on the distance from any point of the stretch to the ${traverse.rover} path, drawn as straight lines between its published waypoints (${traverse.source}); the rover's own track between waypoints can bend. Measured at the stretch's ends and middle, plus a quarter of its length. Distance only: driven ground is not ground known to be safe to walk`
  const out: Classified<number>[] = []
  for (let i = 0; i < stretches; i++) {
    const a = path[i]
    const b = path[i + 1]
    const lengthKm = surfaceDistanceKm(a, b)
    const farthestKm = Math.max(
      distanceToPathKm(a, rover),
      distanceToPathKm(pointAlong(a, b, 0.5), rover),
      distanceToPathKm(b, rover),
    )
    out.push(derived(Math.ceil((farthestKm + lengthKm / 4) * 1000), method))
  }
  return out
}

/**
 * One figure for a whole leg, which can have up to 199 stretches, too many to
 * show one by one: the largest of `provenGround`'s bounds, so no point of the
 * leg is farther from the rover's path. DERIVED, or UNAVAILABLE with the reason.
 */
export function farthestFromRoverPath(
  path: Classified<MarsCoordinate[]>,
  traverse: Classified<RoverTraverse>,
): Classified<number> {
  if (!isAvailable(traverse)) return unavailable(`The rover's path could not be read: ${traverse.reason}`)
  if (!isAvailable(path)) return unavailable(`This leg has no line to measure from the rover's path: ${path.reason}`)
  const stretches = provenGround(path.value, traverse.value)
  if (stretches.length === 0) return unavailable('This leg has no line to measure from the rover\'s path: it has no stretch')
  let farthest = 0
  let method = ''
  for (const stretch of stretches) {
    if (stretch.classification !== 'DERIVED') return stretch
    method = stretch.method
    farthest = Math.max(farthest, stretch.value)
  }
  return derived(farthest, `The largest over this leg's ${stretches.length} stretches. ${method}`)
}

/** "within 40 m of the rover path", "within 1.3 km of the rover path": never "safe". */
export function describeProvenGround(distanceM: number, rover = 'rover'): string {
  const d = distanceM < 1000 ? `${Math.ceil(distanceM)} m` : `${(Math.ceil(distanceM / 100) / 10).toFixed(1)} km`
  return `within ${d} of the ${rover} path`
}

/** Distance from `p` to the polyline through `line`, km, in a plane tangent at `p`. */
export function distanceToPathKm(p: MarsCoordinate, line: readonly MarsCoordinate[]): number {
  const kmPerDegLat = (MARS_MEAN_RADIUS_KM * Math.PI) / 180
  const kmPerDegLon = kmPerDegLat * Math.cos((p.latitude * Math.PI) / 180)
  const project = (c: MarsCoordinate) => ({
    x: (((((c.longitudeEast - p.longitudeEast) % 360) + 540) % 360) - 180) * kmPerDegLon,
    y: (c.latitude - p.latitude) * kmPerDegLat,
  })
  let best = Number.POSITIVE_INFINITY
  let prev = project(line[0])
  if (line.length === 1) return Math.hypot(prev.x, prev.y)
  for (let k = 1; k < line.length; k++) {
    const cur = project(line[k])
    best = Math.min(best, distanceToSegment(prev, cur))
    prev = cur
  }
  return best
}

/** Distance from the origin to segment ab. */
function distanceToSegment(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(a.x * dx + a.y * dy) / len2))
  return Math.hypot(a.x + t * dx, a.y + t * dy)
}
