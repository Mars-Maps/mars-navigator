import { Vector3 } from 'three'
import { formatMarsCoordinate, isAvailable, type WalkKind, type WalkPlan } from '../../domain'
import { coordinateToLocalPoint } from './projection'

/** What the globe draws of a plan: arrays ready for a BufferGeometry. */
export interface WalkPlanGeometry {
  /** Pairs of points, one pair per segment, for LineSegments. */
  segments: Float32Array
  /** Distance along the walk at each `segments` vertex, scene units: dashes run on across the stops. */
  lineDistances: Float32Array
  /** One point per stop, in walking order. */
  stops: Float32Array
  /** One point per sample, in walking order (`order`), at the plan's own coordinates. */
  samples: Float32Array
}

const EMPTY: WalkPlanGeometry = {
  segments: new Float32Array(0),
  lineDistances: new Float32Array(0),
  stops: new Float32Array(0),
  samples: new Float32Array(0),
}

/**
 * The plan's own lines, stops and samples at `radius`. Only a
 * leg's `path` is drawn, as the planner gave it. A leg with an UNAVAILABLE
 * path, or fewer than two points, draws nothing: joining its stops would
 * show a line nobody planned. Its stops still draw. Samples are drawn where
 * the plan puts them and never worked out here.
 */
export function walkPlanGeometry(plan: WalkPlan | null, radius: number): WalkPlanGeometry {
  if (plan === null) return EMPTY

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

  const ordered = sortedSamples(plan)
  const samples = new Float32Array(ordered.length * 3)
  ordered.forEach((s, i) => coordinateToLocalPoint(s.coordinate, radius, a).toArray(samples, i * 3))

  return { segments: new Float32Array(segments), lineDistances: new Float32Array(lineDistances), samples, stops }
}

/** The plan's samples in walking order; none for a plan without them. */
export function sortedSamples(plan: WalkPlan | null) {
  return plan?.samples ? [...plan.samples].sort((x, y) => x.order - y.order) : []
}

/**
 * Each walk's line colour, so three walks on the map are told apart
 * on every layer: kept clear of the hazard points' red and the
 * samples' green, and of each other. A goal walk, with no kind, stays white
 * as before.
 */
export const WALK_KIND_COLOUR: Record<WalkKind, number> = {
  'flat-bedrock': 0xffc34d,
  'rim-to-floor': 0x5cc8ff,
  'rover-check': 0xd08cff,
}
export const GOAL_WALK_COLOUR = 0xffffff

/** The green of a sample point. */
export const SAMPLE_GREEN = 0x2fd06a

export function walkColour(plan: WalkPlan): number {
  return plan.kind ? WALK_KIND_COLOUR[plan.kind] : GOAL_WALK_COLOUR
}

/**
 * What a sample's point says under the pointer: its number, its minutes,
 * the unit under it where the sample is at a stop (the stop's unit, OFFICIAL
 * from the map), and its place.
 */
export function samplePointNames(plan: WalkPlan | null): string[] {
  if (!plan) return []
  const ordered = sortedSamples(plan)
  return ordered.map((s) => {
    const stop = plan.stops.find(
      (t) => t.coordinate.latitude === s.coordinate.latitude && t.coordinate.longitudeEast === s.coordinate.longitudeEast,
    )
    const unit = stop && stop.unit.classification !== 'UNAVAILABLE' ? ` · ${stop.unit.value.name}` : ''
    return `Sample ${s.order} of ${ordered.length} · ${s.dwellMin} min${unit} · ${formatMarsCoordinate(s.coordinate)}`
  })
}
