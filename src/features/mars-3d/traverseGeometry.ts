import { Vector3 } from 'three'
import type { TraversePoint } from '../../domain'
import { coordinateToLocalPoint } from './projection'

/**
 * Pure geometry for the rover's driven path, kept out of the
 * component so it can be tested without a renderer. Positions are in the
 * globe mesh's local space, through the same convention as every other
 * surface point.
 *
 * One vertex per published waypoint, in feed order (oldest first, as
 * RoverTraverse promises): waypoints are metres to a few hundred metres
 * apart, so straight chords between them stay on the surface at any zoom
 * the globe allows, and "the path up to a sol" is a vertex count. Nothing
 * is smoothed, joined or filled in between waypoints.
 */

/** Vertex positions (x, y, z per waypoint) on the sphere of `radius`. */
export function traversePositions(points: readonly TraversePoint[], radius: number): Float32Array {
  const out = new Float32Array(points.length * 3)
  const p = new Vector3()
  for (let i = 0; i < points.length; i++) {
    coordinateToLocalPoint(points[i].coordinate, radius, p).toArray(out, i * 3)
  }
  return out
}

/**
 * The index of the shown waypoint (among the first `count`) whose screen
 * position is nearest (x, y), if one is within `maxPx`; null otherwise.
 * `screen` holds x, y per waypoint in CSS pixels, NaN for one hidden behind
 * the globe. A linear scan, which a few thousand waypoints and a throttled
 * pointer can afford; the last of equally near waypoints wins, so the
 * newest drive is the one named where the path crosses itself.
 */
export function nearestOnScreen(
  screen: Float32Array,
  count: number,
  x: number,
  y: number,
  maxPx: number,
): number | null {
  let best: number | null = null
  let bestSq = maxPx * maxPx
  const n = Math.min(count, screen.length / 2)
  for (let i = 0; i < n; i++) {
    const dx = screen[i * 2] - x
    const dy = screen[i * 2 + 1] - y
    const d = dx * dx + dy * dy
    // NaN compares false, so hidden waypoints never win.
    if (d <= bestSq) {
      bestSq = d
      best = i
    }
  }
  return best
}
