import type { SourcedHeights } from '../data/adapters/LayeredElevation'
import {
  MARS_MEAN_RADIUS_KM,
  SUITED_SLOPE_LIMIT,
  derived,
  insideBounds,
  unavailable,
  type Classified,
  type GeologicFeatures,
  type GeologicUnit,
  type GeologicUnitArea,
  type MarsCoordinate,
  type MissionSettings,
  type MissionSite,
  type RoverTraverse,
  type ScienceGoal,
  type SiteBounds,
  type SlopeLimit,
  type WalkLeg,
  type WalkStop,
} from '../domain'
import { CRATER_NEAR_KM } from '../features/route-analysis/mappedObstacles'
import { farthestFromRoverPath } from '../features/route-analysis/provenGround'
import { DEFAULT_MAX_WALK_KM, SCIENCE_GOALS, candidateStops, confirmStops, returnStop, stopReason } from '../features/route-analysis/scienceGoals'
import { walkLegs, type CellKmAlong, type WalkHeights } from '../features/route-analysis/walkLegs'
import type { WalkDraft } from './planWalks'
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
 * the two steps, stops on the goal's units then legs between them, with the map's data read here so features never see the adapters.
 */
export interface WalkPlanner {
  goals: readonly ScienceGoal[]
  /** The start and the stops, or why there are none. */
  candidateStops: (goal: ScienceGoal, start: MarsCoordinate, signal: AbortSignal) => Promise<Classified<WalkStop[]>>
  /** At the cited suited limit unless `limit` says otherwise (the mission settings). */
  walkLegs: (stops: readonly WalkStop[], signal: AbortSignal, limit?: SlopeLimit) => Promise<WalkLeg[]>
  /** Walk 1, the flat bedrock: its stops within the settings, confirmed on the map, and its sample places. */
  flatBedrock: (start: MarsCoordinate, settings: MissionSettings, signal: AbortSignal) => Promise<Classified<WalkDraft>>
}

export function createWalkPlanner(sources: WalkPlannerSources): WalkPlanner {
  const { site } = sources
  return {
    goals: SCIENCE_GOALS,
    candidateStops: async (goal, start, signal) => {
      // Inside the sheet, so straight legs between stops on its units stay on it:
      // ground the map does not cover could never read as checked and clear.
      const problem = landingSiteProblem(start, site)
      if (problem !== null) return unavailable(problem)
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
    walkLegs: async (stops, signal, limit = SUITED_SLOPE_LIMIT) => {
      // An unread map goes on as it is: `walkLegs` says so on each leg, never reads it as clear.
      const [obstacles, traverse] = await Promise.all([
        sources.features(boxAround(stops.map((s) => s.coordinate), CRATER_NEAR_KM * 2), signal),
        sources.traverse(signal).catch((e: unknown) => unavailable<RoverTraverse>(e instanceof Error ? e.message : String(e))),
      ])
      const legs = await walkLegs(stops, sources.heights, sources.cellKmAlong, obstacles, limit, signal)
      return legs.map((leg) => ({ ...leg, farthestFromRoverPathM: farthestFromRoverPath(leg.path, traverse) }))
    },
    flatBedrock: async (start, settings, signal) => {
      const problem = landingSiteProblem(start, site)
      if (problem !== null) return unavailable(problem)
      const units = await sources.units(boxAround([start], DEFAULT_MAX_WALK_KM), signal)
      if (units.classification === 'UNAVAILABLE') return unavailable(`The map's units around this start could not be read: ${units.reason}`)
      // Loaded on first use: a static import put the first load over its 500 kB.
      const { FLAT_BEDROCK_GOAL, FLAT_BEDROCK_REACH_BASIS, FLAT_BEDROCK_REASONS, flatBedrockStops, floorSamplePlacesKm } = await import(
        '../features/route-analysis/flatBedrockWalk'
      )
      const draft = flatBedrockStops(start, units.value, settings)
      if (draft.classification === 'UNAVAILABLE') return draft
      // Each stop's unit as the map answers for its exact point, as the single-goal planner does.
      const reads = await Promise.all(draft.value.stops.map((s) => sources.unitAt(s.coordinate, signal)))
      const { outKm, placements, samples } = draft.value
      const stops = confirmStops(FLAT_BEDROCK_GOAL, draft.value.stops, reads, outKm, (unit, stop) =>
        stopReason(FLAT_BEDROCK_GOAL, unit, outKm, { placement: placements[stop.id], reachBasis: FLAT_BEDROCK_REACH_BASIS }),
      )
      // Every stop after the landing site was there, so the map's reads dropped them all.
      if (stops.length < 2) return unavailable(FLAT_BEDROCK_REASONS.otherUnits)
      // On the stops as confirmed: a dropped stop changes the walk the places lie along. On the way
      // out only: the way back is for coming back, and over one polygon it is the ground already sampled.
      const placesKm = floorSamplePlacesKm(stops.map((s) => s.coordinate), units.value, samples)
      const method = draft.classification === 'DERIVED' ? draft.method : draft.source
      // The walk ends where it began. A stop the map dropped only shortens it, so the reach still holds.
      const closed = [...stops, returnStop(FLAT_BEDROCK_GOAL, stops.length + 1, stops[0])]
      return derived({ goal: FLAT_BEDROCK_GOAL, stops: closed, ...(placesKm.length > 0 ? { placesKm } : {}) }, method)
    },
  }
}

/**
 * Why no walk can start at `point`, or null when one can: the panel
 * says it at the landing site, before the planner is asked, and the planner
 * gives the same reason.
 */
export function landingSiteProblem(point: MarsCoordinate, site: Pick<MissionSite, 'name' | 'bounds' | 'map'>): string | null {
  return insideBounds(point, site.bounds)
    ? null
    : `This landing site is outside the ${site.map.id} map sheet, the only map a walk can be planned on (${site.name})`
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
    const { heights, sourceIndex, sources, failed } = read.value
    return { ...read, value: failed ? { heights, model: sourceIndex, models: sources, failed } : { heights, model: sourceIndex, models: sources } }
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
 * What the panel shows of its planning, given where the walk lands now. A
 * failure or a run in progress belongs to the landing site it was for, so
 * neither shows once the site has moved.
 */
export function planStatusAt(
  status: { status: PlanStatus; at: MarsCoordinate | null },
  start: MarsCoordinate | null,
): PlanStatus {
  return status.status.kind !== 'idle' && status.at !== start ? { kind: 'idle' } : status.status
}

