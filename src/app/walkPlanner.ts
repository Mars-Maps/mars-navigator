import type { SourcedHeights } from '../data/adapters/LayeredElevation'
import {
  MARS_MEAN_RADIUS_KM,
  SUITED_SLOPE_LIMIT,
  derived,
  insideBounds,
  unavailable,
  walkPlanProblem,
  type Classified,
  type GeologicFeatures,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type MissionSite,
  type RoverTraverse,
  type ScienceGoal,
  type SiteBounds,
  type WalkLeg,
  type WalkPlan,
  type WalkStop,
} from '../domain'
import { CRATER_NEAR_KM } from '../features/route-analysis/mappedObstacles'
import { farthestFromRoverPath } from '../features/route-analysis/provenGround'
import { DEFAULT_MAX_WALK_KM, SCIENCE_GOALS, candidateStops, confirmStops } from '../features/route-analysis/scienceGoals'
import { walkLegs, type CellKmAlong, type WalkHeights } from '../features/route-analysis/walkLegs'
import type { PlanStatus } from '../features/mission-ui/walk/GoalPicker'
import { canTransition, useMissionStore, useWalkPlan } from '../state'

/** What the planner reads: the site's map and the elevation chain. */
export interface WalkPlannerSources {
  site: Pick<MissionSite, 'name' | 'bounds' | 'map'>
  units: (bounds: SiteBounds, signal: AbortSignal) => Promise<Classified<GeologicUnitArea[]>>
  /** The unit at one exact point, with the map's text; UNAVAILABLE on a contact. */
  unitAt: (point: MarsCoordinate, signal: AbortSignal) => Promise<Classified<GeologicUnit>>
  features: (bounds: SiteBounds, signal: AbortSignal) => Promise<Classified<GeologicFeatures>>
  heights: WalkHeights
  cellKmAlong: CellKmAlong
  /** The rover's driven path. A failed read never fails the plan: each leg says why it has no distance. */
  traverse: (signal: AbortSignal) => Promise<Classified<RoverTraverse>>
}

/**
 * The walk planner as the shell uses it: the goals to pick from and
 * the two steps, stops on the goal's units then legs between them,
 * with the map's data read here so features never see the adapters.
 */
export interface WalkPlanner {
  goals: readonly ScienceGoal[]
  /** The start and the stops, or why there are none. */
  candidateStops: (goal: ScienceGoal, start: MarsCoordinate, signal: AbortSignal) => Promise<Classified<WalkStop[]>>
  walkLegs: (stops: readonly WalkStop[], signal: AbortSignal) => Promise<WalkLeg[]>
}

export function createWalkPlanner(sources: WalkPlannerSources): WalkPlanner {
  const { site } = sources
  return {
    goals: SCIENCE_GOALS,
    candidateStops: async (goal, start, signal) => {
      // Inside the sheet, so straight legs between stops on its units stay on it:
      // ground the map does not cover could never read as checked and clear.
      if (!insideBounds(start, site.bounds)) {
        return unavailable(`This start is outside the ${site.map.id} map sheet, the only map a walk can be planned on (${site.name})`)
      }
      const units = await sources.units(boxAround([start], DEFAULT_MAX_WALK_KM), signal)
      if (units.classification === 'UNAVAILABLE') return unavailable(`The map's units around this start could not be read: ${units.reason}`)
      const candidates = candidateStops(goal, start, units.value)
      const reads = await Promise.all(candidates.map((s) => sources.unitAt(s.coordinate, signal)))
      const stops = confirmStops(goal, candidates, reads)
      if (stops.length < 2) {
        return unavailable(`${site.map.id} has no other ground of the goal "${goal.label}" within ${DEFAULT_MAX_WALK_KM} km of this start`)
      }
      return derived(stops, "Stops on the goal's units of the site's geologic map")
    },
    walkLegs: async (stops, signal) => {
      // An unread map goes on as it is: `walkLegs` says so on each leg, never reads it as clear.
      const [obstacles, traverse] = await Promise.all([
        sources.features(boxAround(stops.map((s) => s.coordinate), CRATER_NEAR_KM * 2), signal),
        sources.traverse(signal).catch((e: unknown) => unavailable<RoverTraverse>(e instanceof Error ? e.message : String(e))),
      ])
      const legs = await walkLegs(stops, sources.heights, sources.cellKmAlong, obstacles, SUITED_SLOPE_LIMIT, signal)
      return legs.map((leg) => ({ ...leg, farthestFromRoverPathM: farthestFromRoverPath(leg.path, traverse) }))
    },
  }
}

/**
 * The box round `points`, `km` wider on every side, for a map query: it decides
 * what gets read, so it errs wide. It may run past 0–360°E or a pole; the
 * adapter refuses a box it cannot send.
 */
export function boxAround(points: readonly MarsCoordinate[], km: number): SiteBounds {
  const kmPerDegLat = (MARS_MEAN_RADIUS_KM * Math.PI) / 180
  const lats = points.map((p) => p.latitude)
  const lons = points.map((p) => p.longitudeEast)
  const south = Math.min(...lats) - km / kmPerDegLat
  const north = Math.max(...lats) + km / kmPerDegLat
  // The widest longitude span at the box's edge nearer a pole; capped, since a site's sheet is never there.
  const cos = Math.max(0.05, Math.cos((Math.max(Math.abs(south), Math.abs(north)) * Math.PI) / 180))
  const dLon = km / (kmPerDegLat * cos)
  return { west: Math.min(...lons) - dLon, east: Math.max(...lons) + dLon, south, north }
}

/** The elevation chain's heights as `walkLegs` takes them, each with the model that answered. */
export function walkHeights(
  elevationsAt: (points: Float64Array, signal: AbortSignal) => Promise<Classified<SourcedHeights>>,
): WalkHeights {
  return async (points, signal) => {
    const read = await elevationsAt(points, signal)
    if (read.classification === 'UNAVAILABLE') return read
    const { heights, sourceIndex, sources } = read.value
    return { ...read, value: { heights, model: sourceIndex, models: sources } }
  }
}

/**
 * Stand on the ground at the plan's first stop, heading for it, so
 * Next stop walks the planned legs from where they begin rather than from
 * wherever the walker was dropped. Does nothing without a plan. From
 * navigation it stands with the route kept, and leaving returns there.
 */
export function standAtWalkStart(): void {
  const { plan, goToStop } = useWalkPlan.getState()
  const { viewMode, enterSurface } = useMissionStore.getState()
  if (!plan || !canTransition(viewMode, 'surface')) return
  goToStop(0)
  enterSurface(plan.stops[0].coordinate)
}

/**
 * What the panel shows of its planning, given where the walk starts now. A
 * failure or a run in progress belongs to the start it was for, so neither
 * shows once the start has moved.
 */
export function planStatusAt(
  status: { status: PlanStatus; at: MarsCoordinate | null },
  start: MarsCoordinate | null,
): PlanStatus {
  return status.status.kind !== 'idle' && status.at !== start ? { kind: 'idle' } : status.status
}

export type PlanResult =
  | { status: 'planned'; plan: WalkPlan }
  | { status: 'failed'; reason: string }
  | { status: 'aborted' }

/**
 * One walk plan for `goal` from `start`: stops, then legs over them, checked
 * against the contract (`walkPlanProblem`) before anyone sees it. A planner
 * that throws, or a broken plan, comes back as a reason, never half a plan.
 */
export async function planWalk(
  planner: WalkPlanner,
  goal: ScienceGoal,
  start: MarsCoordinate,
  signal: AbortSignal,
): Promise<PlanResult> {
  try {
    const stops = await planner.candidateStops(goal, start, signal)
    if (signal.aborted) return { status: 'aborted' }
    if (stops.classification === 'UNAVAILABLE') return { status: 'failed', reason: stops.reason }
    const legs = await planner.walkLegs(stops.value, signal)
    if (signal.aborted) return { status: 'aborted' }
    const plan: WalkPlan = { goal, stops: stops.value, legs, slopeLimit: SUITED_SLOPE_LIMIT }
    const problem = walkPlanProblem(plan)
    return problem === null ? { status: 'planned', plan } : { status: 'failed', reason: problem }
  } catch (e) {
    if (signal.aborted) return { status: 'aborted' }
    return { status: 'failed', reason: `The planner failed: ${e instanceof Error ? e.message : String(e)}` }
  }
}
