import type { RouteOption, RouteRequest } from '../../../domain'
import type { StepCost } from '../terrainSearch'
import { SUITED_MAX_KMH, WALKING_SPEED_METHOD, suitedWalkingKmh } from '../walkingSpeed'
import { SEARCH_PENDING_REASON, pendingOption, planSearchedRoute, withinSlopeLimit } from './searchedRoute'
import type { RouteTerrain, RoutingStrategy } from './types'

/**
 * Least time on foot: the terrain search with each
 * step costed in hours, its length over the walking speed for its slope.
 * Steps over the suited slope limit, or across a line the map marks as a
 * ridge crest, crater rim or delta front, are not walked at all.
 */

/** What `plan` says until `planOnTerrain` answers. */
export const FASTEST_PENDING_REASON = SEARCH_PENDING_REASON

/** Hours for one step; Infinity over the slope limit, so the search never takes it. */
export const fastestStepHours: StepCost = withinSlopeLimit((distanceKm, s) => distanceKm / suitedWalkingKmh(s))

export const fastest: RoutingStrategy = {
  id: 'fastest',
  objective: 'Least time on foot from departure to destination, through the stops in order',
  requires: [
    'An elevation model as the search lattice: the site model read whole inside its box, the global model by row ranges elsewhere',
    'A cited walking-speed model: Tobler (1993) scaled to the NASA EVA-EXP-0075 level pace',
  ],
  plan: (request) => pendingOption('fastest', request),
  planOnTerrain: planFastest,
}

export function planFastest(request: RouteRequest, terrain: RouteTerrain, signal: AbortSignal): Promise<RouteOption> {
  return planSearchedRoute(
    'fastest',
    request,
    terrain,
    {
      cost: fastestStepHours,
      minCostPerKm: 1 / SUITED_MAX_KMH,
      sentence: 'Each step costs its length over the walking speed for its slope',
      model: WALKING_SPEED_METHOD,
    },
    signal,
  )
}
