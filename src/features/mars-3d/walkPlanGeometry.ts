import { Vector3 } from 'three'
import { isAvailable, type WalkPlan } from '../../domain'
import { coordinateToLocalPoint } from './projection'

/** What the globe draws of a plan: arrays ready for a BufferGeometry. */
export interface WalkPlanGeometry {
  /** Pairs of points, one pair per segment, for LineSegments. */
  segments: Float32Array
  /** Distance along the walk at each `segments` vertex, scene units: dashes run on across the stops. */
  lineDistances: Float32Array
  /** One point per stop, in walking order. */
  stops: Float32Array
}

/**
 * The plan's own lines and stops at `radius`. Only a leg's `path` is
 * drawn, as the planner gave it. A leg with an UNAVAILABLE path, or fewer than
 * two points, draws nothing: joining its stops would show a line nobody planned.
 * Its stops still draw.
 */
export function walkPlanGeometry(plan: WalkPlan | null, radius: number): WalkPlanGeometry {
  if (plan === null) return { segments: new Float32Array(0), lineDistances: new Float32Array(0), stops: new Float32Array(0) }

  const a = new Vector3()
  const b = new Vector3()
  const segments: number[] = []
  const lineDistances: number[] = []
  let walked = 0
  for (const leg of plan.legs) {
    if (!isAvailable(leg.path)) continue
    const path = leg.path.value
    for (let i = 1; i < path.length; i++) {
      coordinateToLocalPoint(path[i - 1], radius, a)
      coordinateToLocalPoint(path[i], radius, b)
      segments.push(a.x, a.y, a.z, b.x, b.y, b.z)
      lineDistances.push(walked)
      walked += a.distanceTo(b)
      lineDistances.push(walked)
    }
  }

  const stops = new Float32Array(plan.stops.length * 3)
  plan.stops.forEach((stop, i) => coordinateToLocalPoint(stop.coordinate, radius, a).toArray(stops, i * 3))

  return { segments: new Float32Array(segments), lineDistances: new Float32Array(lineDistances), stops }
}
