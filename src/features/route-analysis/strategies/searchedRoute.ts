import {
  SUITED_SLOPE_LIMIT,
  derived,
  official,
  type MarsCoordinate,
  type RouteOption,
  type RouteRequest,
  type RouteStrategy,
  type SurfacePoint,
} from '../../../domain'
import { detectHazards } from '../hazards'
import { OBSTACLE_KINDS } from '../mappedObstacles'
import { METABOLIC_COST_METHOD, walkingKcalPerKm } from '../metabolicCost'
import { searchLeg, type SearchedLeg, type StepCost } from '../terrainSearch'
import { WALKING_SPEED_METHOD, suitedWalkingKmh } from '../walkingSpeed'
import { placeholderOption, requestedPoints } from './placeholder'
import type { RouteTerrain } from './types'

/**
 * What the strategies that route on terrain share: the search
 * leg by leg with the strategy's own step cost, and the option built from
 * the legs found. Distance, time and energy are then priced along the one
 * path by their own cited models, whichever of them chose it, so every
 * searched option shows all three.
 */

/** What `plan` says until `planOnTerrain` answers. */
export const SEARCH_PENDING_REASON = 'Being planned on the elevation model; the route appears when the search finishes'

export const MAX_GRADIENT = Math.tan((SUITED_SLOPE_LIMIT.deg * Math.PI) / 180)
const LINE_KINDS = OBSTACLE_KINDS.lines.map((k) => `"${k}"`).join(', ')
const BLOCKED = `ground steeper than ${SUITED_SLOPE_LIMIT.deg}° (${SUITED_SLOPE_LIMIT.label}) or a line the map marks as ${LINE_KINDS}`

/**
 * What every searched route keeps off its path, as the path's method says it:
 * the hazards panel reads these through `keptOffBySearch`, so the
 * panel and the method can never word the rule differently.
 */
const SLOPE_KEPT_OFF = `Steps over ${SUITED_SLOPE_LIMIT.deg}° (${SUITED_SLOPE_LIMIT.label}; ${SUITED_SLOPE_LIMIT.source}) are not walked`
const LINES_KEPT_OFF = `Steps crossing a line the map marks as ${LINE_KINDS} are not walked; small craters and ridged ground are not avoided`

/** `cost` over walkable ground; Infinity over the suited slope limit, so the search never takes the step. */
export const withinSlopeLimit =
  (cost: StepCost): StepCost =>
  (distanceKm, s) =>
    Math.abs(s) > MAX_GRADIENT ? Number.POSITIVE_INFINITY : cost(distanceKm, s)

/** How a strategy prices a step, and how it says so. */
export interface SearchCost {
  cost: StepCost
  /** A lower bound on `cost` per km, for the search's heuristic. */
  minCostPerKm: number
  /** "Each step costs …", for the path's method. */
  sentence: string
  /** The cited model behind `cost`, for the path's method. */
  model: string
}

/** Every waypoint is the same point, so there is nothing to search or price. */
export const SAME_POINT_REASON = 'The departure, destination and any stops are all the same point, so there is no route to walk'

/** The same place: exactly equal, or equal across 0°/360°E. Never "close enough", which would drop a real short leg. */
function samePoint(a: MarsCoordinate, b: MarsCoordinate): boolean {
  return a.latitude === b.latitude && (a.longitudeEast - b.longitudeEast) % 360 === 0
}

/**
 * What the search kept off this route's path, by hazard kind, in the
 * method's own words: for the hazards panel, where a kind with no
 * detector would otherwise read only "not scanned". Empty for a route that
 * was not searched (shortest, or a search that found no path); no
 * `mapped-obstacle` entry where the map was not read for every leg, since
 * then the lines were not kept off. It says what was avoided, never that
 * the route is clear.
 */
export function keptOffBySearch(option: RouteOption): Partial<Record<'slope' | 'mapped-obstacle', string>> {
  if (option.path.classification !== 'DERIVED') return {}
  const { method } = option.path
  if (!method.includes(lowerFirst(SLOPE_KEPT_OFF))) return {}
  return method.includes(LINES_KEPT_OFF) ? { slope: SLOPE_KEPT_OFF, 'mapped-obstacle': LINES_KEPT_OFF } : { slope: SLOPE_KEPT_OFF }
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

/** The option a searching strategy answers with before its search. */
export function pendingOption(strategy: RouteStrategy, request: RouteRequest): RouteOption {
  return placeholderOption(strategy, request, SEARCH_PENDING_REASON, {
    distance: SEARCH_PENDING_REASON,
    duration: SEARCH_PENDING_REASON,
    energy: SEARCH_PENDING_REASON,
  })
}

/** The route searched leg by leg, as an option; or the placeholder with the failing leg's reason. */
export async function planSearchedRoute(
  strategy: RouteStrategy,
  request: RouteRequest,
  terrain: RouteTerrain,
  search: SearchCost,
  signal: AbortSignal,
): Promise<RouteOption> {
  const waypoints = [request.departure, ...request.stops, request.destination]
  // A leg from a point to itself is no walk. Searched, its level joins out to
  // the nearest node and back would be priced as one, so it is skipped.
  const walked = waypoints.flatMap((_, i) => (i > 0 && !samePoint(waypoints[i - 1], waypoints[i]) ? [i] : []))
  if (walked.length === 0) {
    return placeholderOption(strategy, request, SAME_POINT_REASON, {
      distance: SAME_POINT_REASON,
      duration: SAME_POINT_REASON,
      energy: SAME_POINT_REASON,
    })
  }
  const legs: SearchedLeg[] = []
  for (const i of walked) {
    const leg = await searchLeg(
      waypoints[i - 1],
      waypoints[i],
      terrain,
      { cost: search.cost, minCostPerKm: search.minCostPerKm, blocked: BLOCKED },
      signal,
    )
    if (leg.classification === 'UNAVAILABLE') {
      const reason = waypoints.length > 2 ? `Leg ${i} of ${waypoints.length - 1}: ${leg.reason}` : leg.reason
      return placeholderOption(strategy, request, reason, { distance: reason, duration: reason, energy: reason })
    }
    legs.push(leg.value)
  }
  return searchedOption(strategy, request, legs, walked, search)
}

/** The option from the legs found; `numbers` are the legs' places in the user's list, a skipped leg counted. */
function searchedOption(
  strategy: RouteStrategy,
  request: RouteRequest,
  legs: SearchedLeg[],
  numbers: number[],
  search: SearchCost,
): RouteOption {
  const methods = [...new Set(legs.map((leg) => leg.method))]
  const searchMethod = methods.length === 1 ? methods[0] : `Per leg: ${methods.join(' / ')}`

  const points = requestedPoints(strategy, request)
  const path: SurfacePoint[] = []
  const sources = new Set<string>()
  legs.forEach((leg, l) => {
    leg.nodes.forEach((node, n) => {
      if (l > 0 && n === 0) return // the stop the previous leg ended on
      sources.add(leg.models[node.model].source)
      path.push({
        id: `${strategy}-p${path.length}`,
        coordinate: node.coordinate,
        elevationMeters: official(node.heightM, leg.models[node.model].source),
      })
    })
  })
  const steps = legs.flatMap((leg) => leg.steps)
  const distanceKm = steps.reduce((sum, step) => sum + step.km, 0)
  const hours = steps.reduce((sum, step) => sum + step.km / suitedWalkingKmh(step.s), 0)
  const kcal = steps.reduce((sum, step) => sum + step.km * walkingKcalPerKm(step.s), 0)
  const unchecked = legs.flatMap((leg, l) => (leg.obstacles.checked ? [] : [`leg ${numbers[l]}: ${leg.obstacles.reason}`]))
  const obstacles =
    unchecked.length === 0
      ? LINES_KEPT_OFF
      : `Mapped lines were not kept off the path (${unchecked.join('; ')})`

  return {
    id: `option-${strategy}`,
    strategy,
    points,
    path: derived(
      path,
      `${searchMethod}. ${search.sentence}, and ${lowerFirst(SLOPE_KEPT_OFF)}. ${obstacles}. ${search.model}. Heights: ${[...sources].join(' | ')}`,
    ),
    metrics: {
      distanceKm: derived(
        distanceKm,
        "Sum of the path's steps, each the straight distance between lattice nodes with its rise, and the level joins to each stop, in a plane tangent at each leg's midpoint",
      ),
      durationHours: derived(hours, `Sum over the path's steps of length over walking speed. ${WALKING_SPEED_METHOD}`),
      metabolicEnergyKcal: derived(kcal, `Sum over the path's steps of length times the cost of walking its slope. ${METABOLIC_COST_METHOD}`),
    },
    // The path's nodes carry heights, so the shielding scan runs along it; `points` have none.
    hazards: detectHazards(path),
  }
}
