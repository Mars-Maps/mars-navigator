import { Vector3 } from 'three'
import type { MarsCoordinate } from '../../domain'
import { coordinateToLocalPoint } from './projection'

/**
 * Pure geometry for the route overlay, kept out of the component so
 * it can be tested without a renderer. Positions are in the globe mesh's
 * local space, through the same convention as every other surface point.
 *
 * This only draws what the user picked. Joining waypoints along great
 * circles is a drawing choice, not a planned path, and nothing here is
 * shown as a measured or derived value.
 */

export {
  draftWaypoints,
  hasRouteLine,
  type OverlayPoint,
  type OverlayPointKind,
  type WaypointDraft,
} from './routeWaypoints'

/** Default spacing of vertices along a leg: short chords stay on the sphere. */
export const MAX_STEP_DEG = 1

/** Below this the two ends are the same point and the leg is skipped. */
const SAME_POINT_RAD = 1e-9

/**
 * Evenly spaced points along a line strip (from greatCirclePath), `step`
 * scene units apart along the path, starting at its first vertex, each
 * pushed back out to `radius` so it sits on the sphere.
 */
export function resamplePath(strip: Float32Array, step: number, radius: number): Float32Array {
  const out: number[] = []
  if (strip.length < 3 || !(step > 0)) return new Float32Array(out)
  const a = new Vector3()
  const b = new Vector3()
  const p = new Vector3()
  a.fromArray(strip, 0)
  out.push(a.x, a.y, a.z)
  // Distance still to travel before the next point.
  let need = step
  for (let i = 3; i < strip.length; i += 3) {
    b.fromArray(strip, i)
    const length = a.distanceTo(b)
    let at = 0
    while (length - at >= need) {
      at += need
      p.lerpVectors(a, b, at / length).setLength(radius)
      out.push(p.x, p.y, p.z)
      need = step
    }
    need -= length - at
    a.copy(b)
  }
  return new Float32Array(out)
}

/**
 * Which of the evenly spaced path points to show at this camera altitude:
 * every `stride`-th, a power of two, so that on-screen spacing stays near
 * `spacingPerAltitude` × altitude. Powers of two keep the shown points a
 * subset of the finer level's, so dots never slide along the path on zoom.
 */
export function pathDotStride(altitude: number, step: number, spacingPerAltitude: number): number {
  const wanted = (altitude * spacingPerAltitude) / step
  if (!(wanted > 1)) return 1
  return 2 ** Math.round(Math.log2(wanted))
}

/**
 * Line-strip vertex positions (x, y, z per vertex) through `waypoints` in
 * order, each leg following the great circle between its ends, with no two
 * consecutive vertices more than `maxStepDeg` apart. Every vertex lies on
 * the sphere of `radius`, so the line never cuts through the planet.
 *
 * A leg between two identical points adds nothing. A leg between exact
 * antipodes has no unique great circle; any one connects them, and this
 * picks the one through the poles (or through 0°E at a pole).
 */
export function greatCirclePath(
  waypoints: readonly MarsCoordinate[],
  radius: number,
  maxStepDeg = MAX_STEP_DEG,
): Float32Array {
  const out: number[] = []
  if (waypoints.length === 0) return new Float32Array(out)
  const maxStepRad = (maxStepDeg * Math.PI) / 180
  const a = new Vector3()
  const b = new Vector3()
  const axis = new Vector3()
  const ortho = new Vector3()
  const p = new Vector3()

  coordinateToLocalPoint(waypoints[0], 1, a)
  out.push(a.x * radius, a.y * radius, a.z * radius)

  for (let i = 1; i < waypoints.length; i++) {
    coordinateToLocalPoint(waypoints[i], 1, b)
    const angle = a.angleTo(b)
    if (angle < SAME_POINT_RAD) continue
    axis.crossVectors(a, b)
    if (axis.lengthSq() < SAME_POINT_RAD) {
      // Antipodes: rotate about any axis perpendicular to a.
      axis.crossVectors(a, Math.abs(a.y) < 0.9 ? p.set(0, 1, 0) : p.set(1, 0, 0))
    }
    axis.normalize()
    // a, ortho span the leg's plane: p(φ) = a cos φ + ortho sin φ.
    ortho.crossVectors(axis, a)
    // The epsilon stops a leg of exactly n steps rounding up to n + 1.
    const steps = Math.max(1, Math.ceil(angle / maxStepRad - 1e-9))
    for (let s = 1; s <= steps; s++) {
      const phi = (angle * s) / steps
      if (s === steps) p.copy(b)
      else p.copy(a).multiplyScalar(Math.cos(phi)).addScaledVector(ortho, Math.sin(phi))
      out.push(p.x * radius, p.y * radius, p.z * radius)
    }
    a.copy(b)
  }
  return new Float32Array(out)
}
