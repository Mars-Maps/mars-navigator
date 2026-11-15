import type { MarsCoordinate } from '../../domain'
import { tangentPlane, type Xy } from './scienceGoals'

/**
 * How much ground a set of sample places spans: the area inside their
 * outline (their convex hull), km². A measure of spread that needs no
 * invented figure for how far one sample "speaks for" the ground round it:
 * samples along one line span nothing, samples round a loop span the loop.
 */

/** The area inside the outline of `points`, in the plane they are given in. 0 for fewer than three, or all on one line. */
export function hullArea(points: readonly Xy[]): number {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y)
  if (sorted.length < 3) return 0
  const cross = (o: Xy, a: Xy, b: Xy) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const half = (list: readonly Xy[]) => {
    const out: Xy[] = []
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop()
      out.push(p)
    }
    out.pop()
    return out
  }
  const hull = [...half(sorted), ...half([...sorted].reverse())]
  let twice = 0
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % hull.length]
    twice += a.x * b.y - b.x * a.y
  }
  return Math.abs(twice) / 2
}

/** The area the places span on the ground, km², in a plane tangent at the first of them. */
export function spannedAreaKm2(places: readonly MarsCoordinate[]): number {
  if (places.length < 3) return 0
  const plane = tangentPlane(places[0])
  return hullArea(places.map(plane.project))
}

/** How the spanned area is worked out, for a method. */
export const SPANNED_AREA_METHOD =
  "The area inside the outline of the sample places (their convex hull), in a plane tangent at the walk. It measures how widely the samples are spread, not ground that was measured: no figure is known for how far one sample speaks for the ground round it"
