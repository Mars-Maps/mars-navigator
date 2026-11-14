import { Vector3 } from 'three'
import { MARS_MEAN_RADIUS_KM, type MarsCoordinate } from '../../../domain'
import { coordinateToLocalPoint, localPointToCoordinate } from '../projection'

/**
 * The walker's drop snapped to the followed route: the drop and the
 * route's path are compared on the screen, where the user aimed, and a
 * drop within `SNAP_RADIUS_PX` of the path moves to its nearest point. The
 * maths is pure: the picker projects the path, this finds the point. The
 * snapped position is DERIVED from the route's DERIVED path, and the note
 * says the walker was moved and how far.
 */

export interface ScreenPoint {
  x: number
  y: number
}

/** How near the path a drop must land, CSS pixels: about the width of a fingertip, well over a route dot. */
export const SNAP_RADIUS_PX = 24

/** The nearest point of the path to the drop: on segment `index` → `index + 1`, `t` of the way along it. */
export interface PathSnap {
  index: number
  t: number
  distancePx: number
}

/**
 * The nearest point of a screen-space polyline to `drop`, within
 * `radiusPx`; null beyond it. A vertex the projection could not place (the
 * far side of the globe) is null, and both segments on it are skipped, so
 * a drop never snaps to a line through the planet.
 */
export function snapToPath(drop: ScreenPoint, path: readonly (ScreenPoint | null)[], radiusPx: number): PathSnap | null {
  let best: PathSnap | null = null
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i]
    const b = path[i + 1]
    if (a === null || b === null) continue
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((drop.x - a.x) * dx + (drop.y - a.y) * dy) / lengthSq))
    const distancePx = Math.hypot(a.x + dx * t - drop.x, a.y + dy * t - drop.y)
    if (distancePx <= radiusPx && (best === null || distancePx < best.distancePx)) best = { index: i, t, distancePx }
  }
  return best
}

const pa = new Vector3()
const pb = new Vector3()

/**
 * The surface coordinate `t` of the way from `a` to `b` along their great
 * circle: the two as unit vectors, blended and pushed back to the sphere.
 * Fine for a route's own segments, which are at most a few kilometres.
 */
export function pointOnSegment(a: MarsCoordinate, b: MarsCoordinate, t: number): MarsCoordinate {
  coordinateToLocalPoint(a, 1, pa)
  coordinateToLocalPoint(b, 1, pb)
  pa.lerp(pb, t)
  if (pa.lengthSq() === 0) return a
  return localPointToCoordinate(pa.normalize(), 1)
}

/** The great-circle distance between two coordinates, metres: the angle between their unit vectors on the mean sphere. */
export function surfaceMetres(a: MarsCoordinate, b: MarsCoordinate): number {
  coordinateToLocalPoint(a, 1, pa)
  coordinateToLocalPoint(b, 1, pb)
  return pa.angleTo(pb) * MARS_MEAN_RADIUS_KM * 1000
}

/** The widget's note after a snap: how far the walker was moved onto the route. */
export function snapNote(movedM: number): string {
  const rounded = Math.round(movedM)
  return `Snapped to the route, ${rounded < 1000 ? `${rounded} m` : `${(movedM / 1000).toFixed(1)} km`}`
}

/** Where a drop lands, and the note to show: the snap when the path is near, else the drop itself and no note. */
export interface DropLanding {
  at: MarsCoordinate
  note: string | null
}

/**
 * The drop on the followed route: `path` is the route's line in order,
 * `project` places a coordinate on the screen (null on the far side). A
 * route with under two points, or one whose line is all behind the globe,
 * snaps to nothing; the picker gives null for a route with no DERIVED path.
 */
export function landDrop(
  drop: MarsCoordinate,
  screen: ScreenPoint,
  path: readonly MarsCoordinate[] | null,
  project: (c: MarsCoordinate) => ScreenPoint | null,
  radiusPx = SNAP_RADIUS_PX,
): DropLanding {
  if (path === null || path.length < 2) return { at: drop, note: null }
  const snap = snapToPath(screen, path.map(project), radiusPx)
  if (snap === null) return { at: drop, note: null }
  const at = pointOnSegment(path[snap.index], path[snap.index + 1], snap.t)
  return { at, note: snapNote(surfaceMetres(drop, at)) }
}
