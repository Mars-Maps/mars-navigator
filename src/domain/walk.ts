import type { Classified } from './classification'
import type { GeologicUnit } from './geology'
import { validateCoordinate, type MarsCoordinate } from './mars'
import type { Hazard } from './terrain'

/**
 * The planned Marswalk: the contract between the
 * planner that makes it (science goals, the walk route) and
 * everything that shows it (HUD, stop card, the surface walk).
 * The planner writes one `WalkPlan` to the shared store; the views
 * only read it, so every screen shows the planner's figures and none works
 * out its own.
 *
 * Not in the plan: rover photos. A stop's photos come from the photo join
 * by the stop's coordinate, so the stop card asks for them itself. A
 * leg is the straight line between its stops, flagged where it meets a hazard,
 * not routed around one (`walkLegs`).
 */

/** What the walk is for: a science goal tied to units of a geologic map. */
export interface ScienceGoal {
  id: string
  /** As the UI names it, e.g. "Delta deposits". */
  label: string
  /** The map's unit names this goal visits, spelled as the map spells them. */
  unitNames: readonly string[]
  /**
   * Why those units serve the goal: DERIVED, its method quoting the map's
   * own description or interpretation and naming the map. Never invented.
   */
  reason: Classified<string>
}

/** A place the walk stops at. The first stop is where the walk starts. */
export interface WalkStop {
  id: string
  /** As the UI names it, e.g. "Stop 2 · Jezero fan 1 unit". */
  label: string
  coordinate: MarsCoordinate
  /** The geologic unit under the stop: OFFICIAL from its map, or UNAVAILABLE with the reason (no map here, a contact, a failed read). */
  unit: Classified<GeologicUnit>
  /** Why this stop serves the goal, as for `ScienceGoal.reason`. */
  reason: Classified<string>
}

/** The walk from one stop to the next. */
export interface WalkLeg {
  fromStopId: string
  toStopId: string
  /** The line walked, both stops included: DERIVED with the routing method, or UNAVAILABLE. */
  path: Classified<MarsCoordinate[]>
  distanceKm: Classified<number>
  /**
   * The steepest stretch of the leg, degrees, uphill and downhill alike, as
   * the planner measured it on the elevation chain.
   */
  steepestSlopeDeg: Classified<number>
  /** Slope over the limit, mapped obstacles and the rest; an empty DERIVED list means scanned and none found. */
  hazards: Classified<Hazard[]>
  /**
   * The most, in metres, any point of the leg is from the rover's path:
   * a distance, never a statement of safety. DERIVED, or UNAVAILABLE
   * with the reason. Absent where the planner did not measure it (the sample
   * plan), so a view shows no row rather than a value nobody worked out.
   */
  farthestFromRoverPathM?: Classified<number>
}

/** A slope figure the walk is checked against, with what it is and where it comes from. */
export interface SlopeLimit {
  deg: number
  /** What the figure is, in the UI's words. */
  label: string
  /** The citation. */
  source: string
}

/** The one cited figure for walking in a suit; not a Mars requirement. */
export const SUITED_SLOPE_LIMIT: SlopeLimit = {
  deg: 20,
  label: 'lunar xEVA figure, not a Mars requirement',
  source: 'NASA EVA-EXP-0075 (2020), p. 6: "Walking up/down/across a slope of up to 20°"',
}

export interface WalkPlan {
  goal: ScienceGoal
  /** In walking order; the first is the start. At least two. */
  stops: readonly WalkStop[]
  /** `legs[i]` goes from `stops[i]` to `stops[i + 1]`: one fewer than the stops. */
  legs: readonly WalkLeg[]
  slopeLimit: SlopeLimit
}

/**
 * Why `plan` breaks the contract above, or null when it keeps it. The store
 * refuses a broken plan, so a view never has to guess which leg goes where.
 */
export function walkPlanProblem(plan: WalkPlan): string | null {
  const { stops, legs, goal } = plan
  if (goal.id === '') return 'The goal has no id'
  if (goal.unitNames.length === 0) return 'The goal names no geologic unit'
  if (stops.length < 2) return `A walk needs at least two stops, not ${stops.length}`
  for (const s of stops) {
    if (s.id === '') return 'A stop has no id'
    const check = validateCoordinate(s.coordinate)
    if (!check.ok) return `Stop ${s.id} is not at a valid coordinate (${check.reason})`
  }
  if (new Set(stops.map((s) => s.id)).size !== stops.length) return 'Two stops share an id'
  if (legs.length !== stops.length - 1) return `${stops.length} stops need ${stops.length - 1} legs, not ${legs.length}`
  for (let i = 0; i < legs.length; i++) {
    if (legs[i].fromStopId !== stops[i].id || legs[i].toStopId !== stops[i + 1].id) {
      return `Leg ${i + 1} must go from ${stops[i].id} to ${stops[i + 1].id}`
    }
  }
  if (!(plan.slopeLimit.deg > 0 && plan.slopeLimit.deg < 90)) return `A slope limit of ${plan.slopeLimit.deg}° is not a slope`
  return null
}
